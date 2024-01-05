const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const bodyParser = require('body-parser');
const morgan = require('morgan'); // Middleware for logging HTTP requests

const app = express();

// Use bodyParser to parse application/json content-type
app.use(bodyParser.json());

// Use morgan for logging incoming requests
app.use(morgan('dev'));


// Configuration for the proxy middleware
const corsProxyOptions = {
    target: 'https://localhost:3000', // The target host
    changeOrigin: true,
    logLevel: 'debug', // Enable verbose logging for the proxy
    
    router: (req) => {
        if (req.headers['x-url-destination']) {
            console.debug('Proxying request to:', req.headers['x-url-destination']);
            return req.headers['x-url-destination'];
        }
        else {
            console.debug('No X-Url-Destination header found');
            throw new Error('You need to set the X-url-destination header');
        }
    },
    onProxyReq: (proxyReq, req, res) => {
        console.debug('Proxying request to:', req.url);
        console.debug('Original request headers:', req.headers);

        proxyReq.removeHeader('x-forwarded-host');
        proxyReq.removeHeader('x-forwarded-proto');
        proxyReq.removeHeader('x-forwarded-for');
        proxyReq.removeHeader('x-url-destination');
        
        console.debug('Modified request headers:', proxyReq.getHeaders());
    },
    onProxyRes: (proxyRes, req, res) => {
        console.debug('Received response with status:', proxyRes.statusCode);
        console.debug('Original response headers:', proxyRes.headers);

        // Adjust response headers based on the original request
        proxyRes.headers['Access-Control-Allow-Origin'] = req.headers['origin'] || '*';
        proxyRes.headers['Access-Control-Allow-Methods'] = req.headers['access-control-request-method'] || 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
        proxyRes.headers['Access-Control-Allow-Headers'] = req.headers['access-control-request-headers'] || 'Origin, Content-Type, Accept, Authorization';

        console.debug('Modified response headers:', proxyRes.headers);
    },
    onError: (err, req, res) => {
        console.error('Proxy encountered an error:', err);
    },
};


// Handle OPTIONS requests directly
app.options('/proxy', (req, res) => {
    console.log('Received OPTIONS request');
    res.header('Access-Control-Allow-Origin', req.headers['origin'] || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Origin, Content-Type, Accept, Authorization');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    res.sendStatus(200);
});

// Apply the CORS proxy middleware to the path '/proxy'
app.use('/proxy', createProxyMiddleware(corsProxyOptions));

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
