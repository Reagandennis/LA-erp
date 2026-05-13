const http = require('http');

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/trip-planning/trips',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Cookie': 'session_token=valid_but_fake'
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Body:', data);
  });
});

req.on('error', console.error);
req.write(JSON.stringify({ title: 'Test trip auth' }));
req.end();
