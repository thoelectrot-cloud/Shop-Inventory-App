const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

// --- DISCORD NOTIFICATION SYSTEM (BULLETPROOF) ---
const https = require('https'); 

// 🚨 CRITICAL: Paste your real Discord Webhook URL between these quotes! 🚨
const DISCORD_WEBHOOK_URL = "https://discord.com/api/webhooks/1557512396954804224/hcZe-ePqbL2iZiobYxKdIAA5ArMx8gb_FhxYcDH1c0PeLCKVg0qTYlYI6vYEtL-ozurN";

function sendDiscordAlert(productName, price) {
  try {
    if (!DISCORD_WEBHOOK_URL || !DISCORD_WEBHOOK_URL.startsWith("https://")) return; 
    
    // Generate a professional 6-digit receipt number
    const receiptNo = Math.floor(100000 + Math.random() * 900000);
    
    // Format the price professionally (e.g., "120" becomes "120.00")
    const formattedPrice = parseFloat(price).toFixed(2);
    
    const payload = JSON.stringify({
      username: "Agadir Store POS", // Changes the bot's name in the chat
      embeds: [{
        author: {
          name: "TRANSACTION APPROVED",
        },
        title: `Receipt #${receiptNo}`,
        description: `**Item Processed:**\n${productName}`,
        color: 2829617, // Sleek dark corporate gray/blue
        fields: [
          { name: "Amount Received", value: `**${formattedPrice} MAD**`, inline: true },
          { name: "Cashier", value: "Register 1", inline: true }
        ],
        footer: {
          text: "Automated Store Ledger"
        },
        timestamp: new Date().toISOString() // Discord will automatically format this to your local time
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
        color: 15158332, // Alert Red color for closing
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
    
    const req = require('https').request(options);
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

// Serve local uploaded images publicly
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Configure Multer storage for real product photos
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// --- CLOUD DATABASE CONNECTION ---
const db = mysql.createPool({
  uri: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

db.getConnection((err, conn) => {
  if (err) {
    console.error("❌ Cloud DB Connection Failed:", err.message);
  } else {
    console.log("✅ Connected to Aiven Cloud Database!");
    conn.release(); 
  }
});;

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
  const query = "INSERT INTO categories (category_name, parent_folder, icon) VALUES (?, ?, ?)";
  db.query(query, [name, parent_folder || null, icon || '📦'], (err) => {
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
  const folderPath = req.query.folderPath;
  db.query("SELECT * FROM products WHERE folder_path = ?", [folderPath], (err, results) => {
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
  
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : '';
  const query = "INSERT INTO products (folder_path, product_name, price, stock_quantity, image_url, color, description, sizes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)";
  
  db.query(query, [folderPath, name, 0, totalStock, imageUrl, color || '', description || '', sizes || '{}'], (err) => {
    if (err) return res.status(500).json({ error: "Failed to insert product" });
    res.json({ success: true });
  });
});

// --- 6. FETCH ALL INVENTORY (For the Dashboard) ---
app.get('/api/inventory', (req, res) => {
  db.query("SELECT id, product_name, folder_path, stock_quantity, color, image_url FROM products", (err, results) => {
    if (err) return res.status(500).json({ error: "Failed to fetch inventory" });
    res.json(results);
  });
});

// --- GET ALL SALES (WITH IMAGES & TIMESTAMPS) ---
app.get('/api/sales', (req, res) => {
  // We use a LEFT JOIN to grab the image from the products table
  const query = `
    SELECT sales.*, products.image_url 
    FROM sales 
    LEFT JOIN products ON sales.product_id = products.id 
    ORDER BY sales.created_at DESC
  `;
  
  db.query(query, (err, results) => {
    if (err) {
      console.error("Error fetching sales:", err);
      return res.status(500).json({ error: "Failed to fetch sales" });
    }
    res.json(results);
  });
});

// --- 8. PROCESS A SALE ---
app.post('/api/sell/:id', (req, res) => {
  const productId = req.params.id;
  const { price, productName, size } = req.body;

  db.query("SELECT stock_quantity, sizes FROM products WHERE id = ?", [productId], (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ error: "Database error" });
    
    let currentTotal = results[0].stock_quantity;
    let sizesObj = JSON.parse(results[0].sizes || '{}');

    if (size && sizesObj[size] > 0) {
      sizesObj[size] -= 1;
      currentTotal -= 1;
    } else {
      return res.status(400).json({ success: false, error: "Size out of stock!" });
    }

    db.query("UPDATE products SET stock_quantity = ?, sizes = ? WHERE id = ?", [currentTotal, JSON.stringify(sizesObj), productId], (err2) => {
      if (err2) return res.status(500).json({ error: "Failed to update stock" });

      // 1. Build the name variable cleanly so the app knows exactly what it is
      const finalName = size ? `${productName} (${size})` : productName;

      // 2. Save it to the database
      db.query("INSERT INTO sales (product_id, product_name, price) VALUES (?, ?, ?)", [productId, finalName, price], () => {
        
        // 3. Send the exact same name to Discord
        if (typeof sendDiscordAlert === 'function') {
          sendDiscordAlert(finalName, price);
        }

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
  const productId = req.params.id;
  const { size, addQty } = req.body;
  const qty = parseInt(addQty);

  db.query("SELECT stock_quantity, sizes FROM products WHERE id = ?", [productId], (err, results) => {
    if (err || results.length === 0) return res.status(500).json({ error: "Database error" });
    
    let currentTotal = results[0].stock_quantity;
    let sizesObj = JSON.parse(results[0].sizes || '{}');

    if (sizesObj[size] !== undefined) {
      sizesObj[size] += qty;
    } else {
      sizesObj[size] = qty;
    }
    currentTotal += qty;

    db.query("UPDATE products SET stock_quantity = ?, sizes = ? WHERE id = ?", [currentTotal, JSON.stringify(sizesObj), productId], (err2) => {
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
  const { tree } = req.body;
  db.query("UPDATE store_settings SET inventory_tree = ? WHERE id = 1", [JSON.stringify(tree)], (err) => {
    if (err) return res.status(500).json({ error: "Failed to save folders" });
    res.json({ success: true });
  });
});
// --- 13. EDIT A PRODUCT ---
app.put('/api/products/:id', (req, res) => {
  const productId = req.params.id;
  const { name, color, description } = req.body;

  const query = "UPDATE products SET product_name = ?, color = ?, description = ? WHERE id = ?";
  
  db.query(query, [name, color, description, productId], (err, results) => {
    if (err) {
      console.error("Database error:", err);
      return res.status(500).json({ error: "Failed to update product" });
    }
    res.json({ success: true });
  });
});

// --- 14. RETURN / EXCHANGE A SALE ---
app.post('/api/return/:saleId', (req, res) => {
  const saleId = req.params.saleId;

  // 1. Find the sale receipt
  db.query("SELECT * FROM sales WHERE sale_id = ?", [saleId], (err, sales) => {
    if (err || sales.length === 0) return res.status(500).json({ error: "Sale not found" });
    
    const sale = sales[0];
    const productId = sale.product_id;
    
    // 2. Extract the exact size from the name string (e.g., "Pink Bag (Standard)" -> "Standard")
    const match = sale.product_name.match(/\(([^)]+)\)$/);
    const size = match ? match[1] : 'Standard';

    // 3. Find the product to update its stock
    db.query("SELECT stock_quantity, sizes FROM products WHERE id = ?", [productId], (err, products) => {
      if (err || products.length === 0) return res.status(500).json({ error: "Product not found in database" });

      let currentTotal = products[0].stock_quantity;
      let sizesObj = JSON.parse(products[0].sizes || '{}');

      // Put the item back on the shelf
      if (sizesObj[size] !== undefined) {
        sizesObj[size] += 1;
      } else {
        sizesObj[size] = 1;
      }
      currentTotal += 1;

      // 4. Save the new stock and burn the old receipt
      db.query("UPDATE products SET stock_quantity = ?, sizes = ? WHERE id = ?", [currentTotal, JSON.stringify(sizesObj), productId], (err2) => {
        if (err2) return res.status(500).json({ error: "Failed to update stock" });

        db.query("DELETE FROM sales WHERE sale_id = ?", [saleId], (err3) => {
          if (err3) return res.status(500).json({ error: "Failed to delete sale" });
          res.json({ success: true });
        });
      });
    });
  });
});
// --- 14. RETURN / EXCHANGE A SALE (BULLETPROOF) ---
app.post('/api/return/:saleId', (req, res) => {
  const saleId = req.params.saleId;
  console.log(`Attempting to return sale #${saleId}...`);

  // 1. Find the sale receipt
  db.query("SELECT * FROM sales WHERE sale_id = ?", [saleId], (err, sales) => {
    if (err) {
        console.error("Error fetching sale:", err);
        return res.status(500).json({ error: "Database error finding sale" });
    }
    if (sales.length === 0) {
        console.log("Sale not found in DB.");
        return res.status(500).json({ error: "Sale not found" });
    }
    
    const sale = sales[0];
    const productId = sale.product_id;
    
    // 2. Safely extract the exact size (protects against missing names)
    const safeName = sale.product_name || "";
    const match = safeName.match(/\(([^)]+)\)$/);
    const size = match ? match[1] : 'Standard';

    // 3. Find the product to update its stock
    db.query("SELECT stock_quantity, sizes FROM products WHERE id = ?", [productId], (err2, products) => {
      if (err2) {
          console.error("Error fetching product:", err2);
          return res.status(500).json({ error: "Database error finding product" });
      }

      // If the product was deleted from inventory, just delete the receipt and exit!
      if (products.length === 0) {
        console.log(`Product ${productId} no longer exists. Deleting receipt only.`);
        db.query("DELETE FROM sales WHERE sale_id = ?", [saleId], (err3) => {
          if (err3) {
              console.error("Error deleting old receipt:", err3);
              return res.status(500).json({ error: "Failed to delete sale" });
          }
          return res.json({ success: true, message: "Receipt deleted (product was already removed)." });
        });
        return; // Stop here!
      }

      // If the product still exists, restock it normally
      let currentTotal = products[0].stock_quantity;
      let sizesObj = {};
      try {
          sizesObj = JSON.parse(products[0].sizes || '{}');
      } catch(e) {
          console.error("Error parsing sizes:", e);
      }

      if (sizesObj[size] !== undefined) {
        sizesObj[size] += 1;
      } else {
        sizesObj[size] = 1;
      }
      currentTotal += 1;

      // 4. Save the new stock and burn the old receipt
      db.query("UPDATE products SET stock_quantity = ?, sizes = ? WHERE id = ?", [currentTotal, JSON.stringify(sizesObj), productId], (err4) => {
        if (err4) {
            console.error("Error updating stock:", err4);
            return res.status(500).json({ error: "Failed to update stock" });
        }

        db.query("DELETE FROM sales WHERE sale_id = ?", [saleId], (err5) => {
          if (err5) {
              console.error("Error deleting receipt after restock:", err5);
              return res.status(500).json({ error: "Failed to delete sale" });
          }
          console.log(`Return successful for sale #${saleId}`);
          res.json({ success: true });
        });
      });
    });
  });
});
// --- 15. END OF DAY ROUTE (NOW EMPTIES THE REGISTER) ---
app.post('/api/z-report', (req, res) => {
  // Grab all sales that haven't been cleared yet
  db.query("SELECT price FROM sales WHERE is_cleared = 0", (err, sales) => {
    if (err) return res.status(500).json({ error: "Database error" });
    
    const totalRevenue = sales.reduce((sum, sale) => sum + (Number(sale.price) || 0), 0);
    const totalItems = sales.length;
    
    // If there are no new sales, don't send a blank report
    if (totalItems === 0) {
      return res.json({ success: true, revenue: 0, items: 0 });
    }

    // Fire the summary to Discord
    if (typeof sendZReportDiscord === 'function') {
      sendZReportDiscord(totalRevenue, totalItems);
    }
    
    // 🚨 CRITICAL: Empty the active register in the database!
    db.query("UPDATE sales SET is_cleared = 1 WHERE is_cleared = 0", (updateErr) => {
      if (updateErr) console.error("Failed to clear register:", updateErr);
      res.json({ success: true, revenue: totalRevenue, items: totalItems });
    });
  });
});
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});