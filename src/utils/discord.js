const axios = require('axios');

const COLORS = {
  GOLD: 0xFFD700,
  GREEN: 0x00C851,
  BLUE: 0x0099CC,
  RED: 0xFF4444,
  PURPLE: 0x9B59B6,
  ORANGE: 0xFF8C00,
  YELLOW: 0xFFFF00,
};

async function sendDiscordMessage(webhookUrl, embed) {
  if (!webhookUrl) {
    console.error('No webhook URL provided');
    return;
  }
  try {
    await axios.post(webhookUrl, { embeds: [embed] });
  } catch (err) {
    console.error('Discord error:', err.response?.data || err.message);
  }
}

function createEmbed(title, fields, color) {
  return {
    title,
    color,
    fields: fields.filter(f => f.value && String(f.value).trim() !== ''),
    timestamp: new Date().toISOString(),
    footer: { text: 'BSM Bot' },
  };
}

module.exports = { sendDiscordMessage, createEmbed, COLORS };
