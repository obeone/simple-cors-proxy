const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const bodyParser = require('body-parser');
const morgan = require('morgan'); // Middleware for logging HTTP requests
const chalk = require('chalk'); // Module to add colors to console output

const app = express();

// Parse application/json content-type
app.use(bodyParser.json());

// Use morgan for logging incoming requests with added color for better readability
app.use(morgan(chalk.blue(':method') + ' ' + chalk.green(':url') + ' ' + chalk.yellow(':status') + ' ' + chalk.magenta(':response-time ms')));

// Middleware to delete headers from the request
const deleteHeadersMiddleware = (req, res, next) => {
    'use strict';

    const { headers } = req;
    const headersToDelete = new Set([
        ...(headers['x-headers-delete'] || '').split(',').map(header => header.trim()),
        ...(process.env.HEADERS_TO_DELETE || '').split(',').map(header => header.trim())
    ]);

    headersToDelete.forEach(header => {
        delete headers[header.toLowerCase()];
    });

    delete headers['x-headers-delete'];

    next();
};

// Middleware to check an optional API key
const checkApiKeyMiddleware = (req, res, next) => {
    'use strict';

    const { headers } = req;
    if (process.env.PROXY_TOKEN) {
        if (req.headers['x-proxy-token'] !== process.env.PROXY_TOKEN) {
            res.sendStatus(401);
            return;
        } else {
            delete headers['x-proxy-token'];
        }
    }

    next();
}


// Configuration for the proxy middleware
const corsProxyOptions = {
    target: 'http://host_to_be_superseeded_by_router', // The target host (replaced by the X-Url-Destination header in router)
    changeOrigin: true,
    logLevel: 'debug', // Enable verbose logging for the proxy
    router: (req) => {
        // Check if the request has a specific destination URL
        if (req.headers['x-url-destination']) {
            const url = new URL(req.headers['x-url-destination']);
            console.debug(chalk.cyan('Proxying request to host :'), chalk.cyanBright(url.origin));
            return url.origin;
        }
        else {
            // Log and throw an error if the X-Url-Destination header is not found
            console.debug(chalk.red('No X-Url-Destination header found'));
            throw new Error('You need to set the X-url-destination header');
        }
    },
    pathRewrite: function (path, req) { 
        // Take the full URL in req['x-url-destination'], and return only the path part
        const url = new URL(req.headers['x-url-destination']);
        console.debug(chalk.cyan('Proxying request to path :'), chalk.cyanBright(url.pathname + url.search));
        return url.pathname + url.search;
    },
    onProxyReq: (proxyReq, req, res) => {
        // Log the proxying of the request and the original request headers
        console.debug(chalk.cyan('Proxying request to:'), chalk.cyanBright(req.url));
        console.debug(chalk.cyan('Original request headers:'), req.headers);

        // Remove specific headers from the proxy request
        proxyReq.removeHeader('x-forwarded-host');
        proxyReq.removeHeader('x-forwarded-proto');
        proxyReq.removeHeader('x-forwarded-for');
        proxyReq.removeHeader('x-url-destination');
        
        // Log the modified request headers
        console.debug(chalk.cyan('Modified request headers:'), proxyReq.getHeaders());
    },
    onProxyRes: (proxyRes, req, res) => {
        // Log the received response status and original response headers
        console.debug(chalk.green('Received response with status:'), chalk.greenBright(proxyRes.statusCode));
        console.debug(chalk.green('Original response headers:'), proxyRes.headers);

        // Adjust response headers based on the original request
        proxyRes.headers['Access-Control-Allow-Origin'] = req.headers['origin'] || '*';
        proxyRes.headers['Access-Control-Allow-Methods'] = req.headers['access-control-request-method'] || 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
        proxyRes.headers['Access-Control-Allow-Headers'] = req.headers['access-control-request-headers'] || 'Origin, Content-Type, Accept, Authorization';
        
        // Log the modified response headers
        console.debug(chalk.green('Modified response headers:'), proxyRes.headers);
    },
    onError: (err, req, res) => {
        // Log any errors encountered by the proxy
        console.error(chalk.red('Proxy encountered an error:'), err);
    },
    
};


// Handle OPTIONS requests directly with user-friendly logging
app.options('/proxy', (req, res) => {
    console.log(chalk.yellow('Received OPTIONS request'));
    res.header('Access-Control-Allow-Origin', req.headers['origin'] || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Origin, Content-Type, Accept, Authorization');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours
    res.sendStatus(200);
});

// Apply the middleware to delete headers
app.use(deleteHeadersMiddleware);
// Apply the middleware to check an optional API key
app.use(checkApiKeyMiddleware);

// Apply the CORS proxy middleware to the path '/proxy'
app.use('/proxy', createProxyMiddleware(corsProxyOptions));

// Start the server with user-friendly logging
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(chalk.green(`Server is running on port ${PORT}`));
});

