const express = require('express');
const cors = require('cors');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

const ADMIN_IPS = [
    '172.59.196.158', 
    '104.179.159.180', 
    '172.58.183.6', 
    '172.59.195.98',
    '192.168.12.160', 
    '192.168.12.230',
    '172.58.183.208'
]

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
    origin: [
        'http://localhost:3000', 
        'https://localhost:3000', 
        'https://vibebeadswebsite.onrender.com', 
        'https://vibebeads.net',
        'http://vibebeads.net'
    ],
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
    
    console.log('Admin verification:', { clientIP, isLocalhost, hostname: req.hostname });
    
    if (isLocalhost || ADMIN_IPS.includes(clientIP)) {
        next();
    } else {
        console.log('Admin access denied for IP:', clientIP);
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

// Get timestamps for update checking
app.get('/api/timestamps', async (req, res) => {
    try {
        const contentData = await loadData(CONTENT_FILE);
        const productData = await loadData(PRODUCTS_FILE);
        
        const contentTimestamps = Object.values(contentData)
            .map(page => page.lastModified)
            .filter(Boolean);
        
        const productTimestamps = Object.values(productData)
            .map(product => product.lastModified)
            .filter(Boolean);
        
        const lastContentUpdate = contentTimestamps.length > 0 
            ? Math.max(...contentTimestamps.map(t => new Date(t).getTime()))
            : 0;
            
        const lastProductUpdate = productTimestamps.length > 0
            ? Math.max(...productTimestamps.map(t => new Date(t).getTime()))
            : 0;
        
        res.json({
            content: lastContentUpdate ? new Date(lastContentUpdate).toISOString() : null,
            products: lastProductUpdate ? new Date(lastProductUpdate).toISOString() : null,
            server: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error getting timestamps:', error);
        res.status(500).json({ error: 'Failed to get timestamps' });
    }
});

// Get public product list (for all users)
app.get('/api/products/list', async (req, res) => {
    try {
        const productData = await loadData(PRODUCTS_FILE);
        
        const publicProducts = Object.entries(productData).map(([id, product]) => ({
            id,
            name: product.name,
            price: product.price,
            description: product.description,
            category: product.category,
            emoji: product.emoji,
            imageUrl: product.imageUrl,
            inStock: product.inStock !== false,
            featured: product.featured || false,
            sizes: product.sizes || ['Standard'],
            scents: product.scents || [],
            colors: product.colors || []
        }));
        
        res.json(publicProducts);
    } catch (error) {
        console.error('Error loading products list:', error);
        res.status(500).json({ error: 'Failed to load products' });
    }
});

// Get content data
app.get('/api/content', async (req, res) => {
    try {
        const contentData = await loadData(CONTENT_FILE);
        res.json(contentData);
    } catch (error) {
        console.error('Error loading content:', error);
        res.status(500).json({ error: 'Failed to load content' });
    }
});

// Save content data (admin only)
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

// Get all products (admin only)
app.get('/api/products', verifyAdmin, async (req, res) => {
    try {
        const productData = await loadData(PRODUCTS_FILE);
        res.json(productData);
    } catch (error) {
        console.error('Error loading products:', error);
        res.status(500).json({ error: 'Failed to load products' });
    }
});

// Add new product (admin only)
app.post('/api/products', verifyAdmin, async (req, res) => {
    try {
        const { productId, productData: data } = req.body;
        
        if (!productId || !data) {
            return res.status(400).json({ error: 'Product ID and data required' });
        }
        
        // Validate required fields
        if (!data.name || !data.price) {
            return res.status(400).json({ error: 'Product name and price are required' });
        }
        
        const productData = await loadData(PRODUCTS_FILE);
        
        // Check if product already exists
        if (productData[productId]) {
            return res.status(409).json({ error: 'Product already exists' });
        }
        
        productData[productId] = {
            ...data,
            id: productId,
            lastModified: new Date().toISOString(),
            modifiedBy: getClientIP(req),
            createdAt: data.createdAt || new Date().toISOString()
        };
        
        await saveData(PRODUCTS_FILE, productData);
        
        console.log('Product added:', productId);
        
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

// Update existing product (admin only) - NEW ENDPOINT
app.put('/api/products/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const updatedData = req.body;
        
        if (!updatedData.name || !updatedData.price) {
            return res.status(400).json({ error: 'Product name and price are required' });
        }
        
        const productData = await loadData(PRODUCTS_FILE);
        
        if (!productData[id]) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        // Preserve original creation data
        const originalProduct = productData[id];
        
        productData[id] = {
            ...updatedData,
            id: id,
            lastModified: new Date().toISOString(),
            modifiedBy: getClientIP(req),
            createdAt: originalProduct.createdAt || new Date().toISOString(),
            createdBy: originalProduct.createdBy || 'admin'
        };
        
        await saveData(PRODUCTS_FILE, productData);
        
        console.log('Product updated:', id);
        
        res.json({ 
            success: true, 
            productId: id,
            timestamp: productData[id].lastModified
        });
    } catch (error) {
        console.error('Error updating product:', error);
        res.status(500).json({ error: 'Failed to update product' });
    }
});

// Delete product (admin only)
app.delete('/api/products/:id', verifyAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const productData = await loadData(PRODUCTS_FILE);
        
        if (productData[id]) {
            delete productData[id];
            await saveData(PRODUCTS_FILE, productData);
            console.log('Product deleted:', id);
            res.json({ success: true, deleted: id });
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (error) {
        console.error('Error deleting product:', error);
        res.status(500).json({ error: 'Failed to delete product' });
    }
});

// Get single product by ID
app.get('/api/products/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const productData = await loadData(PRODUCTS_FILE);
        
        if (productData[id]) {
            res.json(productData[id]);
        } else {
            res.status(404).json({ error: 'Product not found' });
        }
    } catch (error) {
        console.error('Error loading product:', error);
        res.status(500).json({ error: 'Failed to load product' });
    }
});

// Reset data (admin only)
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
        
        console.log('Data reset:', type);
        res.json({ success: true, reset: type });
    } catch (error) {
        console.error('Error resetting data:', error);
        res.status(500).json({ error: 'Failed to reset data' });
    }
});

// Get admin info (admin only)
app.get('/api/admin/info', verifyAdmin, async (req, res) => {
    try {
        const contentData = await loadData(CONTENT_FILE);
        const productData = await loadData(PRODUCTS_FILE);
        
        res.json({
            contentPages: Object.keys(contentData).length,
            totalProducts: Object.keys(productData).length,
            lastActivity: new Date().toISOString(),
            serverUptime: process.uptime(),
            adminIPs: ADMIN_IPS
        });
    } catch (error) {
        console.error('Error getting admin info:', error);
        res.status(500).json({ error: 'Failed to get admin info' });
    }
});

// Error handling middleware
app.use((error, req, res, next) => {
    console.error('Server error:', error);
    res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// Process error handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

// Start server
ensureDataDirectory().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
        console.log(`Admin IPs: ${ADMIN_IPS.join(', ')}`);
        console.log(`API URL: ${process.env.NODE_ENV === 'production' ? 'https://adminbackend-4ils.onrender.com' : `http://localhost:${PORT}`}/api`);
        console.log(`Data directory: ${DATA_DIR}`);
    });
}).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
});

module.exports = app;