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
const deleteRequestHeadersMiddleware = (req, res, next) => {
    'use strict';

    const { headers } = req;
    const requestHeadersToDelete = new Set([
        ...(headers['headers-to-delete'] || headers['x-headers-delete'] || '').split(',').map(header => header.trim()),
        ...(process.env.HEADERS_TO_DELETE || process.env.REQUEST_HEADERS_TO_DELETE || '').split(',').map(header => header.trim())
    ]);

    requestHeadersToDelete.forEach(header => {
        delete headers[header.toLowerCase()];
    });

    delete headers['headers-to-delete'];
    delete headers['x-headers-delete']; // Kept for compatibility
    

    next();
};

// Middleware to delete headers from the response
const deleteResponseHeadersMiddleware = (req, res, next) => {
    res.on('finish', () => {
        const responseHeadersToDelete = new Set([
            ...(res.getHeader('headers-to-delete-response') || '').split(',').map(header => header.trim()),
            ...(process.env.RESPONSE_HEADERS_TO_DELETE || '').split(',').map(header => header.trim())
        ]);

        responseHeadersToDelete.forEach(header => {
            res.removeHeader(header);
        });
    });
    next();
};

const checkApiKeyMiddleware = (req, res, next) => {
    'use strict';

    const token = req.query.token || req.headers['x-proxy-token'];
    if (process.env.PROXY_TOKEN && token !== process.env.PROXY_TOKEN) {
        res.sendStatus(401);
        return;
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
        const url = req.query.url || req.headers['x-url-destination'];
        if (url) {
            console.debug(chalk.cyan('Proxying request to host :'), chalk.cyanBright(new URL(url).origin));
            return new URL(url).origin;
        }
        else {
            // Log and throw an error if the URL is not found
            console.debug(chalk.red('No URL found in query parameter or X-Url-Destination header'));
            throw new Error('You need to provide the URL as a query parameter or set the X-url-destination header');
        }
    },
    pathRewrite: function (path, req) { 
        // Take the full URL in req.query.url or req['x-url-destination'], and return only the path part
        const url = req.query.url || req.headers['x-url-destination'];
        console.debug(chalk.cyan('Proxying request to path :'), chalk.cyanBright(new URL(url).pathname + new URL(url).search));
        return new URL(url).pathname + new URL(url).search;
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

// Apply the middleware to check an optional API key
app.use(checkApiKeyMiddleware);

// Apply the CORS proxy middleware to the path '/proxy'
app.use('/proxy', createProxyMiddleware(corsProxyOptions));


// Apply the middleware to delete request headers
app.use(deleteRequestHeadersMiddleware);
// Apply the middleware to delete response headers
app.use(deleteResponseHeadersMiddleware);

// Add a debug message


// Start the server with user-friendly logging
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(chalk.green(`Server is running on port ${PORT}`));
});

