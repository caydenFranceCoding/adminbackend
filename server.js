// server.js - Minimal Admin Backend for Vibe Beads
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3001;

// Allowed admin IPs
const ADMIN_IPS = ['192.168.1.100', '10.0.0.50', '203.0.113.45', '192.168.1.243', '104.179.159.180'];

// In-memory storage (will persist during app lifetime)
let contentData = {};
let productData = {};

// Middleware
app.use(cors({ 
    origin: ['http://localhost:3000', 'https://vibebeadswebsite.onrender.com', 'https://localhost:3000'],
    credentials: true 
}));
app.use(express.json({ limit: '10mb' }));

// Remove trailing slashes
app.use((req, res, next) => {
    if (req.path.substr(-1) === '/' && req.path.length > 1) {
        const query = req.url.slice(req.path.length);
        res.redirect(301, req.path.slice(0, -1) + query);
    } else {
        next();
    }
});

// Get client IP helper
function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0] || 
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           req.ip;
}

// Admin verification middleware
function verifyAdmin(req, res, next) {
    const clientIP = getClientIP(req);
    const isLocalhost = req.hostname === 'localhost' || 
                       clientIP?.includes('127.0.0.1') || 
                       clientIP?.includes('::1');
    
    console.log(`Admin check - IP: ${clientIP}, Localhost: ${isLocalhost}`);
    
    if (isLocalhost || ADMIN_IPS.includes(clientIP)) {
        next();
    } else {
        res.status(403).json({ error: 'Access denied', ip: clientIP });
    }
}

// Health check
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// Admin status check
app.get('/api/admin/status', verifyAdmin, (req, res) => {
    res.json({ 
        authorized: true, 
        ip: getClientIP(req),
        timestamp: new Date().toISOString()
    });
});

// Get all content
app.get('/api/content', (req, res) => {
    res.json(contentData);
});

// Save content (admin only)
app.post('/api/content', verifyAdmin, (req, res) => {
    const { page, changes, timestamp } = req.body;
    
    if (!page || !changes) {
        return res.status(400).json({ error: 'Page and changes required' });
    }
    
    // Store changes
    contentData[page] = {
        ...changes,
        lastModified: timestamp || new Date().toISOString(),
        modifiedBy: getClientIP(req)
    };
    
    console.log(`Content saved for page: ${page} by IP: ${getClientIP(req)}`);
    
    res.json({ 
        success: true, 
        page,
        timestamp: contentData[page].lastModified
    });
});

// Get all products
app.get('/api/products', (req, res) => {
    res.json(productData);
});

// Save product (admin only)
app.post('/api/products', verifyAdmin, (req, res) => {
    const { productId, productData: data } = req.body;
    
    if (!productId || !data) {
        return res.status(400).json({ error: 'Product ID and data required' });
    }
    
    productData[productId] = {
        ...data,
        lastModified: new Date().toISOString(),
        modifiedBy: getClientIP(req)
    };
    
    res.json({ 
        success: true, 
        productId,
        timestamp: productData[productId].lastModified
    });
});

// Delete product (admin only)
app.delete('/api/products/:id', verifyAdmin, (req, res) => {
    const { id } = req.params;
    
    if (productData[id]) {
        delete productData[id];
        res.json({ success: true, deleted: id });
    } else {
        res.status(404).json({ error: 'Product not found' });
    }
});

// Reset content (admin only)
app.post('/api/reset', verifyAdmin, (req, res) => {
    const { type } = req.body;
    
    if (type === 'content') {
        contentData = {};
    } else if (type === 'products') {
        productData = {};
    } else if (type === 'all') {
        contentData = {};
        productData = {};
    }
    
    console.log(`Reset performed: ${type} by IP: ${getClientIP(req)}`);
    
    res.json({ success: true, reset: type });
});

// Get admin info
app.get('/api/admin/info', verifyAdmin, (req, res) => {
    res.json({
        contentPages: Object.keys(contentData).length,
        totalProducts: Object.keys(productData).length,
        lastActivity: new Date().toISOString(),
        serverUptime: process.uptime()
    });
});

// Error handling
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Vibe Beads Admin Server running on port ${PORT}`);
    console.log(`🔐 Admin access allowed from IPs: ${ADMIN_IPS.join(', ')}`);
    console.log(`🌐 API Base URL: ${process.env.NODE_ENV === 'production' ? 'https://adminbackend-4ils.onrender.com' : `http://localhost:${PORT}`}/api`);
});

module.exports = app;
