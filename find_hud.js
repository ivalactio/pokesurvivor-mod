const https = require('https');

https.get('https://raw.githubusercontent.com/JPTER78/pokesurvivor/main/js/app.min.js', res => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const idx = data.indexOf("Math['ceil'](_0x52c975['hp'])");
    console.log(data.slice(idx - 1500, idx + 1000));
  });
});
