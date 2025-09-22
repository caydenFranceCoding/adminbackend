const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

const ADMIN_IPS = ['104.28.33.73']

const DATA_DIR = path.join(__dirname, 'data');
const CONTENT_FILE = path.join(DATA_DIR, 'content.json');
const PRODUCTS_FILE = path.join(DATA_DIR, 'products.json');

async function ensureDataDirectory() {
    try {
        await fs.access(DATA_DIR);
    } catch {
        await fs.mkdir(DATA_DIR, { recursive: true });
    }
}

async function loadData(filename) {
    try {
        const data = await fs.readFile(filename, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}

async function saveData(filename, data) {
    await ensureDataDirectory();
    const tempFile = filename + '.tmp';
    await fs.writeFile(tempFile, JSON.stringify(data, null, 2));
    await fs.rename(tempFile, filename);
}

app.use(cors({ 
    origin: ['http://localhost:3000', 'https://vibebeadswebsite.onrender.com', 'https://localhost:3000', 'https://vibebeads.net'],
    credentials: true 
}));

app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
    if (req.path.substr(-1) === '/' && req.path.length > 1) {
        const query = req.url.slice(req.path.length);
        res.redirect(301, req.path.slice(0, -1) + query);
    } else {
        next();
    }
});

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
           req.headers['x-real-ip'] ||
           req.connection.remoteAddress || 
           req.socket.remoteAddress ||
           req.ip;
}

function verifyAdmin(req, res, next) {
    const clientIP = getClientIP(req);
    const isLocalhost = req.hostname === 'localhost' || 
                       clientIP?.includes('127.0.0.1') || 
                       clientIP?.includes('::1') ||
                       clientIP === '::ffff:127.0.0.1';
    
    if (isLocalhost || ADMIN_IPS.includes(clientIP)) {
        next();
    } else {
        res.status(403).json({ error: 'Access denied', ip: clientIP });
    }
}

app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.get('/api/admin/status', verifyAdmin, (req, res) => {
    res.json({ 
        authorized: true, 
        ip: getClientIP(req),
        timestamp: new Date().toISOString()
    });
});

app.get('/api/content', async (req, res) => {
    try {
        const contentData = await loadData(CONTENT_FILE);
        res.json(contentData);
    } catch (error) {
        console.error('Error loading content:', error);
        res.status(500).json({ error: 'Failed to load content' });
    }
});

app.post('/api/content', verifyAdmin, async (req, res) => {
    try {
        const { page, changes, timestamp } = req.body;
        
        if (!page || !changes) {
            return res.status(400).json({ error: 'Page and changes required' });
        }
        
        const contentData = await loadData(CONTENT_FILE);
        
        contentData[page] = {
            ...changes,
            lastModified: timestamp || new Date().toISOString(),
            modifiedBy: getClientIP(req)
        };
        
        await saveData(CONTENT_FILE, contentData);
        
        res.json({ 
            success: true, 
            page,
            timestamp: contentData[page].lastModified
        });
    } catch (error) {
        console.error('Error saving content:', error);
        res.status(500).json({ error: 'Failed to save content' });
    }
});

app.get('/api/products', async (req, res) => {
    try {
        const productData = await loadData(PRODUCTS_FILE);
        res.json(productData);
    } catch (error) {
        console.error('Error loading products:', error);
        res.status(500).json({ error: 'Failed to load products' });
    }
});

app.post('/api/products', verifyAdmin, async (req, res) => {
    try {
        const { productId, productData: data } = req.body;
        
        if (!productId || !data) {
            return res.status(400).json({ error: 'Product ID and data required' });
        }
        
        const productData = await loadData(PRODUCTS_FILE);
        
        productData[productId] = {
            ...data,
            lastModified: new Date().toISOString(),
            modifiedBy: getClientIP(req)
        };
        
        await saveData(PRODUCTS_FILE, productData);
        
        res.json({ 
            success: true, 
            productId,
            timestamp: productData[productId].lastModified
        });
    } catch (error) {
        console.error('Error saving product:', error);
        res.status(500).json({ error: 'Failed to save product' });
    }
});

app.delete('/api/products/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const productData = await loadData(PRODUCTS_FILE);
        
        if (productData[id]) {
            delete productData[id];
            await saveData(PRODUCTS_FILE, productData);
            res.json({ success: true, deleted: id });
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

app.post('/api/reset', verifyAdmin, async (req, res) => {
    try {
        const { type } = req.body;
        
        if (type === 'content') {
            await saveData(CONTENT_FILE, {});
        } else if (type === 'products') {
            await saveData(PRODUCTS_FILE, {});
        } else if (type === 'all') {
            await saveData(CONTENT_FILE, {});
            await saveData(PRODUCTS_FILE, {});
        } else {
            return res.status(400).json({ error: 'Invalid reset type' });
        }
        
        res.json({ success: true, reset: type });
    } catch (error) {
        console.error('Error resetting data:', error);
        res.status(500).json({ error: 'Failed to reset data' });
    }
});

app.get('/api/admin/info', verifyAdmin, async (req, res) => {
    try {
        const contentData = await loadData(CONTENT_FILE);
        const productData = await loadData(PRODUCTS_FILE);
        
        res.json({
            contentPages: Object.keys(contentData).length,
            totalProducts: Object.keys(productData).length,
            lastActivity: new Date().toISOString(),
            serverUptime: process.uptime()
        });
    } catch (error) {
        console.error('Error getting admin info:', error);
        res.status(500).json({ error: 'Failed to get admin info' });
    }
});

app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

ensureDataDirectory().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Admin IPs: ${ADMIN_IPS.join(', ')}`);
        console.log(`API URL: ${process.env.NODE_ENV === 'production' ? 'https://adminbackend-4ils.onrender.com' : `http://localhost:${PORT}`}/api`);
    });
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

module.exports = app;