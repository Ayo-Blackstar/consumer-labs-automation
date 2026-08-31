const express = require('express');
const router = express.Router();
const { sendDiscordMessage, createEmbed, COLORS } = require('../utils/discord');
const axios = require('axios');

const processedEmails = new Map();
const DEDUP_WINDOW_MS = 10 * 60 * 1000;

function isDuplicateEmail(email) {
  if (!email) return false;
  const now = Date.now();
  if (processedEmails.has(email)) {
    const timestamp = processedEmails.get(email);
    if (now - timestamp < DEDUP_WINDOW_MS) {
      console.log(`Duplicate email blocked: ${email}`);
      return true;
    }
  }
  processedEmails.set(email, now);
  for (const [k, t] of processedEmails.entries()) {
    if (now - t > DEDUP_WINDOW_MS) processedEmails.delete(k);
  }
  return false;
}

function abbreviateTitle(title) {
  const map = {
    'first name': 'First Name',
    'last name': 'Last Name',
    'phone': 'Phone',
    'email': 'Email',
    'company': 'Company',
    'business name': 'Business Name',
    'website': 'Website',
    'how did you hear': 'Source',
    'what is your monthly revenue': 'Monthly Revenue',
    'what is your biggest challenge': 'Biggest Challenge',
    'how soon': 'Timeline',
    'investment': 'Investment',
    'what industry': 'Industry',
    'what does your team': 'Team Size',
    'book': 'Calendar Booking',
    'schedule': 'Calendar Booking',
    'calendly': 'Calendar Booking',
  };
  const lower = title.toLowerCase();
  for (const [key, val] of Object.entries(map)) {
    if (lower.includes(key)) return val;
  }
  return title;
}

function getContactGHLLink(contactId) {
  return `https://app.gohighlevel.com/v2/location/${process.env.GHL_LOCATION_ID}/contacts/detail/${contactId}`;
}

async function createGHLContact(contactData) {
  try {
    const response = await axios.post(
      'https://services.leadconnectorhq.com/contacts/',
      contactData,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28'
        }
      }
    );
    console.log('GHL contact created:', response.data?.contact?.id);
    return response.data?.contact;
  } catch (err) {
    if (err.response?.status === 400 && err.response?.data?.meta?.contactId) {
      console.log('GHL contact already exists:', err.response.data.meta.contactId);
      return { id: err.response.data.meta.contactId };
    }
    console.error('GHL contact error:', err.response?.status, JSON.stringify(err.response?.data));
    return null;
  }
}

async function updateGHLContact(contactId, data) {
  try {
    await axios.put(
      `https://services.leadconnectorhq.com/contacts/${contactId}`,
      data,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28'
        }
      }
    );
    console.log('GHL contact updated:', contactId);
  } catch (err) {
    console.error('GHL contact update error:', err.response?.status, JSON.stringify(err.response?.data));
  }
}

async function createGHLOpportunity(contact, stageId, monetaryValue, source) {
  try {
    const pipelineId = process.env.GHL_PIPELINE_ID;
    if (!pipelineId || !stageId || !contact?.id) return null;
    const name = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.email || 'New Lead';
    const response = await axios.post(
      'https://services.leadconnectorhq.com/opportunities/',
      {
        pipelineId,
        pipelineStageId: stageId,
        contactId: contact.id,
        name,
        locationId: process.env.GHL_LOCATION_ID,
        status: 'open',
        monetaryValue,
        source,
      },
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Content-Type': 'application/json',
          'Version': '2021-07-28'
        }
      }
    );
    console.log('GHL opportunity created:', response.data?.opportunity?.id);
    return response.data?.opportunity;
  } catch (err) {
    console.error('GHL opportunity error:', err.response?.status, JSON.stringify(err.response?.data));
    return null;
  }
}

async function findAndUpdateOpportunityStage(contactId, stageId) {
  try {
    const pipelineId = process.env.GHL_PIPELINE_ID;
    if (!pipelineId || !stageId || !contactId) return null;
    const response = await axios.get(
      `https://services.leadconnectorhq.com/opportunities/search?location_id=${process.env.GHL_LOCATION_ID}&contact_id=${contactId}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
          'Version': '2021-07-28'
        }
      }
    );
    const opportunities = response.data?.opportunities || [];
    const opportunity = opportunities.find(o => o.pipelineId === pipelineId);
    if (opportunity) {
      await axios.put(
        `https://services.leadconnectorhq.com/opportunities/${opportunity.id}`,
        { pipelineStageId: stageId },
        {
          headers: {
            'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28'
          }
        }
      );
      console.log('GHL opportunity stage updated');
      return opportunity;
    }
    return null;
  } catch (err) {
    console.error('GHL opportunity update error:', err.response?.status, JSON.stringify(err.response?.data));
    return null;
  }
}

async function addGHLNote(contactId, noteText) {
  try {
    const headers = {
      'Authorization': `Bearer ${process.env.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    };
    await axios.post(
      `https://services.leadconnectorhq.com/contacts/${contactId}/notes`,
      { body: noteText },
      { headers }
    );
    const oppResponse = await axios.get(
      `https://services.leadconnectorhq.com/opportunities/search?location_id=${process.env.GHL_LOCATION_ID}&contact_id=${contactId}`,
      { headers }
    );
    const opportunities = oppResponse.data?.opportunities || [];
    const opportunity = opportunities.find(o => o.pipelineId === process.env.GHL_PIPELINE_ID) || opportunities[0];
    if (opportunity) {
      await axios.post(
        `https://services.leadconnectorhq.com/opportunities/${opportunity.id}/notes`,
        { body: noteText },
        { headers }
      );
      console.log('Opportunity note added:', opportunity.id);
    }
  } catch (err) {
    console.error('GHL note error:', err.response?.data || err.message);
  }
}

router.post('/webhook', async (req, res) => {
  try {
    const payload = req.body;
    const answers = payload.form_response?.answers || [];
    const fields_def = payload.form_response?.definition?.fields || [];
    const hidden = payload.form_response?.hidden || {};

    const discordFields = [];
    let hasCalendly = false;
    let firstName = '';
    let lastName = '';
    let phone = '';
    let email = '';
    let source = '';
    let calendlyValue = '';
    const noteLines = ['📋 Typeform Application:\n'];

    const now = new Date().toLocaleDateString('en-GB');
    discordFields.push({ name: 'Time', value: now, inline: true });

    answers.forEach((answer, index) => {
      const fieldDef = fields_def[index];
      const rawTitle = fieldDef?.title || `Question ${index + 1}`;
      const fieldTitle = abbreviateTitle(rawTitle);
      let value = '';

      switch (answer.type) {
        case 'text': value = answer.text || ''; break;
        case 'email': value = answer.email || ''; email = value; break;
        case 'phone_number': value = answer.phone_number || ''; phone = value; break;
        case 'choice': value = answer.choice?.label || ''; break;
        case 'choices': value = answer.choices?.labels?.join(', ') || ''; break;
        case 'boolean': value = answer.boolean ? 'Yes' : 'No'; break;
        case 'number': value = String(answer.number) || ''; break;
        case 'calendly':
          hasCalendly = true;
          calendlyValue = answer.url || 'Call Booked ✅';
          return;
        case 'url':
          value = answer.url || '';
          if (value.includes('calendly.com') && value.includes('invitees')) {
            hasCalendly = true;
            calendlyValue = value;
            return;
          }
          break;
        default:
          value = answer.url || answer.text || answer.email || '';
          if (value && value.includes('calendly.com') && value.includes('invitees')) {
            hasCalendly = true;
            calendlyValue = value;
            return;
          }
      }

      const titleLower = rawTitle.toLowerCase();
      if (titleLower.includes('first name')) firstName = value;
      if (titleLower.includes('last name')) lastName = value;
      if (titleLower.includes('how did you hear')) source = value;

      if (fieldTitle === 'Calendar Booking') {
        if (value && value.includes('calendly.com')) {
          discordFields.push({ name: 'Call Booking', value: String(value).substring(0, 1024), inline: true });
        }
        return;
      }

      if (value) {
        noteLines.push(`${fieldTitle}: ${value}`);
        discordFields.push({
          name: fieldTitle.substring(0, 256),
          value: String(value).substring(0, 1024),
          inline: true
        });
      }
    });

    // UTM data
    if (hidden && Object.keys(hidden).length > 0) {
      const utmLines = Object.entries(hidden)
        .filter(([k, v]) => v && v.trim())
        .map(([k, v]) => `**${k}:** ${v}`)
        .join('\n');
      if (utmLines) {
        discordFields.push({ name: 'ATTRIBUTION', value: utmLines, inline: false });
        noteLines.push(`\nUTM Attribution:\n${Object.entries(hidden).filter(([k,v]) => v).map(([k,v]) => `${k}: ${v}`).join('\n')}`);
      }
    }

    const noteText = noteLines.join('\n');

    const contact = await createGHLContact({
      firstName,
      lastName,
      email,
      phone,
      locationId: process.env.GHL_LOCATION_ID,
      source: source || 'typeform',
      tags: ['typeform-lead'],
    });

    const fullName = `${firstName} ${lastName}`.trim() || email;
    if (contact?.id) {
      const ghlLink = getContactGHLLink(contact.id);
      discordFields.splice(1, 0, { name: 'Contact', value: `[${fullName}](${ghlLink})`, inline: true });
    }

    if (hasCalendly) {
      if (contact?.id) {
        const updateData = { tags: ['typeform-lead', 'typeform-booked'] };
        if (phone) updateData.phone = phone;
        if (firstName) updateData.firstName = firstName;
        if (lastName) updateData.lastName = lastName;
        await updateGHLContact(contact.id, updateData);

        const existing = await findAndUpdateOpportunityStage(contact.id, process.env.GHL_PIPELINE_BOOKED_STAGE_ID);
        if (!existing) {
          await createGHLOpportunity(contact, process.env.GHL_PIPELINE_BOOKED_STAGE_ID, 0, 'typeform');
        }
        await addGHLNote(contact.id, noteText);
      }

      if (calendlyValue && !discordFields.find(f => f.name === 'Call Booking')) {
        discordFields.push({ name: 'Call Booking', value: String(calendlyValue).substring(0, 1024), inline: true });
      }

      const embed = createEmbed('📞 New Call Booked', discordFields, COLORS.GOLD);
      await sendDiscordMessage(process.env.DISCORD_WEBHOOK_BOOKED_CALLS, embed);

    } else {
      if (!isDuplicateEmail(email)) {
        if (contact?.id) {
          if (phone) await updateGHLContact(contact.id, { phone });
          await createGHLOpportunity(contact, process.env.GHL_PIPELINE_STAGE_ID, 0, 'typeform');
          await addGHLNote(contact.id, noteText);
        }

        const embed = createEmbed('🆕 New Lead Optin', discordFields, COLORS.BLUE);
        await sendDiscordMessage(process.env.DISCORD_WEBHOOK_NEW_LEADS, embed);
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Typeform webhook error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
