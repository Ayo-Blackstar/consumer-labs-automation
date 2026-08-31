const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const typeformRoutes = require('./routes/typeform');
const ghlRoutes = require('./routes/ghl');
const eodRoutes = require('./routes/eod');

app.use('/typeform', typeformRoutes);
app.use('/ghl', ghlRoutes);
app.use('/eod', eodRoutes);

app.get('/', (req, res) => res.json({ status: 'Consumer Labs Automation Running' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
