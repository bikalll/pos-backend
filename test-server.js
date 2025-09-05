console.log('Starting server test...');

try {
  const express = require('express');
  console.log('Express loaded successfully');
  
  const app = express();
  const PORT = 3000;
  
  app.get('/', (req, res) => {
    res.json({ message: 'Server is running!' });
  });
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Test server running on http://0.0.0.0:${PORT}`);
    console.log(`Your phone should connect to: http://192.168.18.150:${PORT}`);
  });
  
} catch (error) {
  console.error('Error starting server:', error);
}
