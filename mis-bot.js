const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
  res.send('UIC MIS BOT RUNNING');
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});

const creds = require('./google-creds.json');

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--single-process'
    ]
  }
});

const MANAGER_PHONE = '9198XXXXXXXX@c.us';
const SHEET_ID = 'PASTE_GOOGLE_SHEET_ID';

const buddies = [
  { name: 'AMAN DESAI', phone: '9198XXXXXXXX@c.us' }
];

const questions = [
  "1) What's your target?",
  "2) Minus doctors visited?",
  "3) Doctor list complete?",
  "4) Call average?",
  "5) Minus 30 completion date?",
  "6) Strategy?",
  "7) New doctors?",
  "8) Corporate leads?",
  "9) Suggestions?"
];

let userState = {};
let doc;

client.on('qr', qr => {
  console.log('SCAN QR');
  qrcode.generate(qr, { small: true });
});

client.on('ready', async () => {
  console.log('BOT READY');
  await initSheet();
  scheduleDailyMIS();
  scheduleReminder();
  scheduleSummary();
});

client.on('message', async msg => {
  const phone = msg.from;
  const buddy = buddies.find(b => b.phone === phone);

  if (!buddy || msg.fromMe) return;

  if (!userState[phone]) {
    userState[phone] = {
      step: 0,
      answers: [],
      name: buddy.name,
      completed: false
    };
  }

  const state = userState[phone];

  if (state.completed) {
    await msg.reply('MIS already submitted');
    return;
  }

  if (state.step > 0) {
    state.answers[state.step - 1] = msg.body.trim();
  }

  if (state.step < questions.length) {
    await client.sendMessage(phone, questions[state.step]);
    state.step++;
  } else {
    await saveToSheet(state.name, state.answers);
    state.completed = true;
    await client.sendMessage(phone, 'MIS Submitted Successfully');
  }
});

async function initSheet() {
  doc = new GoogleSpreadsheet(SHEET_ID);
  await doc.useServiceAccountAuth(creds);
  await doc.loadInfo();
  console.log('Google Sheet Connected');
}

async function saveToSheet(name, answers) {
  const sheet = doc.sheetsByIndex[0];

  await sheet.addRow({
    Timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    Buddy: name,
    Q1: answers[0] || '',
    Q2: answers[1] || '',
    Q3: answers[2] || '',
    Q4: answers[3] || '',
    Q5: answers[4] || '',
    Q6: answers[5] || '',
    Q7: answers[6] || '',
    Q8: answers[7] || '',
    Q9: answers[8] || ''
  });
}

function scheduleDailyMIS() {
  cron.schedule('0 19 * * *', async () => {
    for (const b of buddies) {
      userState[b.phone] = {
        step: 1,
        answers: [],
        name: b.name,
        completed: false
      };

      await client.sendMessage(
        b.phone,
        `Daily MIS Time\n\n${questions[0]}`
      );
    }
  }, {
    timezone: 'Asia/Kolkata'
  });
}

function scheduleReminder() {
  cron.schedule('0 21 * * *', async () => {
    for (const b of buddies) {
      const state = userState[b.phone];

      if (state && !state.completed) {
        await client.sendMessage(
          b.phone,
          'Reminder: MIS Pending'
        );
      }
    }
  }, {
    timezone: 'Asia/Kolkata'
  });
}

function scheduleSummary() {
  cron.schedule('30 22 * * *', async () => {
    let completed = 0;
    let summary = '*UIC MIS SUMMARY*\n\n';

    for (const b of buddies) {
      const state = userState[b.phone];

      if (state && state.completed) {
        completed++;
        summary += `✅ ${b.name}\n`;
      } else {
        summary += `❌ ${b.name}\n`;
      }
    }

    summary += `\nSubmitted: ${completed}/${buddies.length}`;

    await client.sendMessage(MANAGER_PHONE, summary);
  }, {
    timezone: 'Asia/Kolkata'
  });
}

client.initialize();
