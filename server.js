const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const bodyParser = require('body-parser');
const morgan = require('morgan'); // Middleware for logging HTTP requests
const chalk = require('chalk'); // Module to add colors to console output

const app = express();

// Parse application/json content-type for incoming requests
app.use(bodyParser.json());

// Use morgan middleware for logging incoming requests with colors for better readability
app.use(morgan(chalk.blue(':method') + ' ' + chalk.green(':url') + ' ' + chalk.yellow(':status') + ' ' + chalk.magenta(':response-time ms')));

/**
 * Middleware to parse URL query parameters and add them as headers to the request.
 * It excludes the special 'url' and 'token' query parameters from being added to headers.
 */
const urlParamsToHeadersMiddleware = (req, res, next) => {
    for (const [key, value] of Object.entries(req.query)) {
        if (key.toLowerCase() !== 'url' && key.toLowerCase() !== 'token') {
            req.headers[key.toLowerCase()] = value;
        }
    }
    next();
};

/**
 * Middleware to delete specified headers from the request.
 * It checks for headers-to-delete specified in the request itself, query parameters, or environment variables.
 */
const deleteRequestHeadersMiddleware = (req, res, next) => {
    const { headers } = req;
    const requestHeadersToDelete = new Set([
        ...(headers['headers-to-delete'] || headers['x-headers-delete'] || '').split(',').map(header => header.trim()),
        ...(req.query['headers-delete'] || '').split(',').map(header => header.trim()), // Add query string support
        ...(process.env.HEADERS_TO_DELETE || '').split(',').map(header => header.trim())
    ]);

    requestHeadersToDelete.forEach(header => {
        delete headers[header.toLowerCase()];
    });

    delete headers['headers-to-delete'];
    delete headers['x-headers-delete']; // Kept for compatibility

    next();
};

/**
 * Middleware to delete specified headers from the response once it finishes.
 * It checks for headers-to-delete-response specified in the response itself or environment variables.
 */
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

/**
 * Middleware to check an optional API key in the request.
 * It looks for an API key (`token`) in query parameters or headers and compares it with the expected token.
 */
const checkApiKeyMiddleware = (req, res, next) => {
    const token = req.query.token || req.headers['x-proxy-token'];
    if (process.env.PROXY_TOKEN && token !== process.env.PROXY_TOKEN) {
        res.sendStatus(401); // Unauthorized
        return;
    }

    next();
};

/**
 * Configuration for the proxy middleware, defining behavior when proxying requests.
 * Handles dynamic target URL determination and modifying both requests and responses.
 */
const corsProxyOptions = {
    target: 'http://host_to_be_superseeded_by_router',
    changeOrigin: true,
    logLevel: 'debug', // Enable verbose logging for the proxy
    router: (req) => {
        const url = req.query.url || req.headers['x-url-destination']; // Determine the destination URL
        if (url) {
            console.debug(chalk.cyan('Proxying request to host :'), chalk.cyanBright(new URL(url).origin));
            return new URL(url).origin;
        } else {
            console.debug(chalk.red('No URL found in query parameter or X-Url-Destination header'));
            throw new Error('You need to provide the URL as a query parameter or set the X-url-destination header');
        }
    },
    pathRewrite: (path, req) => { 
        const url = req.query.url || req.headers['x-url-destination']; // Determine the full destination URL
        console.debug(chalk.cyan('Proxying request to path :'), chalk.cyanBright(new URL(url).pathname + new URL(url).search));
        return new URL(url).pathname + new URL(url).search;
    },
    onProxyReq: (proxyReq, req, res) => {
        console.debug(chalk.cyan('Proxying request to:'), chalk.cyanBright(req.url));
        console.debug(chalk.cyan('Original request headers:'), req.headers);

        // Remove specific headers from being forwarded by the proxy
        ['x-forwarded-host', 'x-forwarded-proto', 'x-forwarded-for', 'x-url-destination'].forEach(header => proxyReq.removeHeader(header));
        
        console.debug(chalk.cyan('Modified request headers:'), proxyReq.getHeaders());
    },
    onProxyRes: (proxyRes, req, res) => {
        console.debug(chalk.green('Received response with status:'), chalk.greenBright(proxyRes.statusCode));
        console.debug(chalk.green('Original response headers:'), proxyRes.headers);

        // Add CORS headers to the response
        proxyRes.headers['Access-Control-Allow-Origin'] = req.headers['origin'] || '*';
        proxyRes.headers['Access-Control-Allow-Methods'] = req.headers['access-control-request-method'] || 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
        proxyRes.headers['Access-Control-Allow-Headers'] = req.headers['access-control-request-headers'] || 'Origin, Content-Type, Accept, Authorization';
        
        console.debug(chalk.green('Modified response headers:'), proxyRes.headers);
    },
    onError: (err, req, res) => {
        console.error(chalk.red('Proxy encountered an error:'), err);
    },
};

// Handle OPTIONS requests for CORS preflight checks with user-friendly logging
app.options('/proxy', (req, res) => {
    console.log(chalk.yellow('Received OPTIONS request'));
    res.header('Access-Control-Allow-Origin', req.headers['origin'] || '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || 'Origin, Content-Type, Accept, Authorization');
    res.header('Access-Control-Max-Age', '86400'); // 24 hours cache duration
    res.sendStatus(200);
});

// Register middlewares for query parameter handling, API key checking, and proxying
app.use('/proxy', urlParamsToHeadersMiddleware);
app.use(checkApiKeyMiddleware);
app.use(deleteRequestHeadersMiddleware); // Ensure this is in use
app.use(deleteResponseHeadersMiddleware); // Ensure this is in use

// Setup the proxy middleware
app.use('/proxy', createProxyMiddleware(corsProxyOptions));

// Start the server with a success message logging
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(chalk.green(`Server is running on port ${PORT}`));
});
