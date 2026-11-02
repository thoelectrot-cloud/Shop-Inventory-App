const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

// --- DISCORD NOTIFICATION SYSTEM ---
const https = require('https'); 
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1557512396954804224/hcZe-ePqbL2iZiobYxKdIAA5ArMx8gb_FhxYcDH1c0PeLCKVg0qTYlYI6vYEtL-ozurN";

function sendDiscordAlert(productName, price) {
  try {
    if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith("https://")) return; 
    
    const receiptNo = Math.floor(100000 + Math.random() * 900000);
    const formattedPrice = parseFloat(price).toFixed(2);
    
    const payload = JSON.stringify({
      username: "Agadir Store POS",
      embeds: [{
        author: { name: "TRANSACTION APPROVED" },
        title: `Receipt #${receiptNo}`,
        description: `**Item Processed:**\n${productName}`,
        color: 2829617,
        fields: [
          { name: "Amount Received", value: `**${formattedPrice} MAD**`, inline: true },
          { name: "Cashier", value: "Register 1", inline: true }
        ],
        footer: { text: "Automated Store Ledger" },
        timestamp: new Date().toISOString()
      }]
    });
    
    const url = new URL(DISCORD_WEBHOOK_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    
    const req = https.request(options);
    req.on('error', (error) => console.error("Discord error:", error.message));
    req.write(payload);
    req.end();
  } catch (err) {
    console.error("Discord Error:", err.message);
  }
}

// --- DISCORD Z-REPORT FUNCTION ---
function sendZReportDiscord(totalRevenue, totalItems) {
  try {
    if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith("https://")) return;
    
    const payload = JSON.stringify({
      username: "Agadir Store POS",
      embeds: [{
        title: "📊 END OF DAY REPORT (Z-REPORT)",
        color: 15158332,
        fields: [
          { name: "Gross Revenue", value: `**${parseFloat(totalRevenue).toFixed(2)} MAD**`, inline: true },
          { name: "Total Items Sold", value: `**${totalItems}**`, inline: true },
          { name: "Date", value: new Date().toLocaleDateString('en-MA', { timeZone: 'Africa/Casablanca' }), inline: false }
        ],
        footer: { text: "Register Closed Successfully" },
        timestamp: new Date().toISOString()
      }]
    });
    
    const url = new URL(DISCORD_WEBHOOK_URL);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    
    const req = https.request(options);
    req.on('error', (e) => console.error("Z-Report Error:", e.message));
    req.write(payload);
    req.end();
  } catch(e) {
    console.error("Z-Report Crash Prevented:", e.message);
  }
}

const app = express();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const upload = multer({ storage: multer.memoryStorage() });

// --- CLOUD DATABASE CONNECTION ---
const db = mysql.createPool({
  uri: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 5,
  connectTimeout: 30000
});
db.getConnection((err, conn) => {
  if (err) {
    console.error("❌ Cloud DB Connection Failed:", err.message);
  } else {
    console.log("✅ Connected to Aiven Cloud Database!");
    conn.release(); 
  }
});


// --- 1. FETCH ALL FOLDERS ---
app.get('/api/categories', (req, res) => {
  db.query("SELECT * FROM categories", (err, results) => {
    if (err) return res.status(500).json({ error: "Failed to fetch categories" });
    res.json(results);
  });
});

// --- 2. SAVE NEW FOLDER ---
app.post('/api/categories', (req, res) => {
  const { name, parent_folder, icon } = req.body;
  db.query("INSERT INTO categories (category_name, parent_folder, icon) VALUES (?, ?, ?)", [name, parent_folder || null, icon || '📦'], (err) => {
    if (err) return res.status(500).json({ error: "Failed to insert category" });
    res.json({ success: true });
  });
});

// --- 3. DELETE FOLDER ---
app.delete('/api/categories', (req, res) => {
  const { name, parent_folder } = req.body;
  let query = "DELETE FROM categories WHERE category_name = ?";
  let params = [name];
  if (parent_folder) {
    query += " AND parent_folder = ?";
    params.push(parent_folder);
  } else {
    query += " AND parent_folder IS NULL";
  }
  db.query(query, params, (err) => {
    if (err) return res.status(500).json({ error: "Failed to delete category" });
    res.json({ success: true });
  });
});

// --- 4. FETCH PRODUCTS FOR A FOLDER ---
app.get('/api/products', (req, res) => {
  db.query("SELECT * FROM products WHERE folder_path = ?", [req.query.folderPath], (err, results) => {
    if (err) return res.status(500).json({ error: "Failed to fetch products" });
    res.json(results);
  });
});

// --- 5. SAVE NEW PRODUCT ---
app.post('/api/products', upload.single('image'), (req, res) => {
  const { folderPath, name, color, description, sizes } = req.body;
  const parsedSizes = JSON.parse(sizes || '{}');
  let totalStock = 0;
  for (let key in parsedSizes) {
    totalStock += parseInt(parsedSizes[key]);
  }
  
  let imageUrl = '';
  if (req.file) {
    const base64Image = req.file.buffer.toString('base64');
    imageUrl = `data:${req.file.mimetype};base64,${base64Image}`;
  }
  
  db.query("INSERT INTO products (folder_path, product_name, price, stock_quantity, image_url, color, description, sizes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [folderPath, name, 0, totalStock, imageUrl, color || '', description || '', sizes || '{}'], (err) => {
    if (err) {
      console.error("Database Error:", err);
      return res.status(500).json({ error: "Failed to insert product" });
    }
    res.json({ success: true });
  });
});

// --- 6. FETCH ALL INVENTORY ---
app.get('/api/inventory', (req, res) => {
  db.query("SELECT id, product_name, folder_path, stock_quantity, color, image_url FROM products", (err, results) => {
    if (err) return res.status(500).json({ error: "Failed to fetch inventory" });
    res.json(results);
  });
});

// --- 7. GET ALL SALES ---
app.get('/api/sales', (req, res) => {
  db.query("SELECT sales.*, products.image_url FROM sales LEFT JOIN products ON sales.product_id = products.id ORDER BY sales.created_at DESC", (err, results) => {
    if (err) return res.status(500).json({ error: "Failed to fetch sales" });
    res.json(results);
  });
});

// --- 8. PROCESS A SALE ---
app.post('/api/sell/:id', (req, res) => {
  const { price, productName, size } = req.body;
  db.query("SELECT stock_quantity, sizes FROM products WHERE id = ?", [req.params.id], (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ error: "Database error" });
    
    let currentTotal = results[0].stock_quantity;
    let sizesObj = JSON.parse(results[0].sizes || '{}');

    if (size && sizesObj[size] > 0) {
      sizesObj[size] -= 1;
      currentTotal -= 1;
    } else {
      return res.status(400).json({ success: false, error: "Size out of stock!" });
    }

    db.query("UPDATE products SET stock_quantity = ?, sizes = ? WHERE id = ?", [currentTotal, JSON.stringify(sizesObj), req.params.id], (err2) => {
      if (err2) return res.status(500).json({ error: "Failed to update stock" });
      const finalName = size ? `${productName} (${size})` : productName;
      db.query("INSERT INTO sales (product_id, product_name, price) VALUES (?, ?, ?)", [req.params.id, finalName, price], () => {
        if (typeof sendDiscordAlert === 'function') sendDiscordAlert(finalName, price);
        res.json({ success: true });
      });
    });
  });
});

// --- 9. DELETE A PRODUCT ---
app.delete('/api/products/:id', (req, res) => {
  db.query("DELETE FROM products WHERE id = ?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Failed to delete product" });
    res.json({ success: true });
  });
});

// --- 10. RESTOCK A PRODUCT ---
app.post('/api/restock/:id', (req, res) => {
  const { size, addQty } = req.body;
  const qty = parseInt(addQty);
  db.query("SELECT stock_quantity, sizes FROM products WHERE id = ?", [req.params.id], (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ error: "Database error" });
    
    let currentTotal = results[0].stock_quantity;
    let sizesObj = JSON.parse(results[0].sizes || '{}');
    sizesObj[size] = (sizesObj[size] || 0) + qty;
    currentTotal += qty;

    db.query("UPDATE products SET stock_quantity = ?, sizes = ? WHERE id = ?", [currentTotal, JSON.stringify(sizesObj), req.params.id], (err2) => {
      if (err2) return res.status(500).json({ error: "Failed to update stock" });
      res.json({ success: true });
    });
  });
});

// --- 11. GET FOLDER TREE ---
app.get('/api/folders', (req, res) => {
  db.query("SELECT inventory_tree FROM store_settings WHERE id = 1", (err, results) => {
    if (err) return res.status(500).json({ error: "Database error" });
    res.json({ tree: results[0] ? results[0].inventory_tree : '{}' });
  });
});

// --- 12. SAVE FOLDER TREE ---
app.post('/api/folders', (req, res) => {
  db.query("UPDATE store_settings SET inventory_tree = ? WHERE id = 1", [JSON.stringify(req.body.tree)], (err) => {
    if (err) return res.status(500).json({ error: "Failed to save folders" });
    res.json({ success: true });
  });
});

// --- 13. EDIT A PRODUCT ---
app.put('/api/products/:id', (req, res) => {
  const { name, color, description } = req.body;
  db.query("UPDATE products SET product_name = ?, color = ?, description = ? WHERE id = ?", [name, color, description, req.params.id], (err) => {
    if (err) return res.status(500).json({ error: "Failed to update product" });
    res.json({ success: true });
  });
});

// --- 14. RETURN / EXCHANGE A SALE (BULLETPROOF) ---
app.post('/api/return/:saleId', (req, res) => {
  const saleId = req.params.saleId;
  db.query("SELECT * FROM sales WHERE sale_id = ?", [saleId], (err, sales) => {
    if (err || sales.length === 0) return res.status(500).json({ error: "Sale not found" });
    
    const sale = sales[0];
    const productId = sale.product_id;
    const match = (sale.product_name || "").match(/\(([^)]+)\)$/);
    const size = match ? match[1] : 'Standard';

    db.query("SELECT stock_quantity, sizes FROM products WHERE id = ?", [productId], (err2, products) => {
      if (err2) return res.status(500).json({ error: "Database error" });

      if (products.length === 0) {
        db.query("DELETE FROM sales WHERE sale_id = ?", [saleId], () => res.json({ success: true }));
        return;
      }

      let currentTotal = products[0].stock_quantity;
      let sizesObj = JSON.parse(products[0].sizes || '{}');
      sizesObj[size] = (sizesObj[size] || 0) + 1;
      currentTotal += 1;

      db.query("UPDATE products SET stock_quantity = ?, sizes = ? WHERE id = ?", [currentTotal, JSON.stringify(sizesObj), productId], () => {
        db.query("DELETE FROM sales WHERE sale_id = ?", [saleId], () => res.json({ success: true }));
      });
    });
  });
});

// --- 15. END OF DAY ROUTE ---
app.post('/api/z-report', (req, res) => {
  db.query("SELECT price FROM sales WHERE is_cleared = 0", (err, sales) => {
    if (err) return res.status(500).json({ error: "Database error" });
    
    const totalRevenue = sales.reduce((sum, sale) => sum + (Number(sale.price) || 0), 0);
    const totalItems = sales.length;
    
    if (totalItems === 0) return res.json({ success: true, revenue: 0, items: 0 });

    if (typeof sendZReportDiscord === 'function') sendZReportDiscord(totalRevenue, totalItems);
    
    db.query("UPDATE sales SET is_cleared = 1 WHERE is_cleared = 0", () => {
      res.json({ success: true, revenue: totalRevenue, items: totalItems });
    });
  });
});

// Serve static files locally
app.use(express.static(path.join(__dirname, '../public')));

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
}
module.exports = app;