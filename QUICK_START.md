# Quick Start Guide - New Customer Features

## Step 1: Import Customer Data (First Time Setup)

Run this command to load all customer data from CSVs:

```bash
python import_customer_data.py
```

This will:
- Clear existing seed data ✓
- Load 2,000+ orders from 5 sales channels
- Create unique customer records
- Calculate customer segments automatically
- Display import summary with stats

**Expected Output:**
```
============================================================
[*] CUSTOMER DATA IMPORT
============================================================

[x] Clearing existing seed data...
   [OK] Seed data cleared

[+] Processing CSV files...
   [OK] Parsed X orders per file

[@] Inserting 500+ unique customers...
   [OK] Customers imported

[P] Inserting 2000+ orders...
   [OK] Orders imported

============================================================
[*] IMPORT SUMMARY
============================================================
[@] Total Customers: 500+
[P] Total Orders: 2,000+
[C] Total Revenue: Rs. X,XXX,XXX
```

---

## Step 2: Access Customer Dashboards

### A. Customer Directory (`/customers`)

**What you see:**
- All customer records with contact info
- Total orders and lifetime spending
- Location data (city, state, pincode)
- Last order date

**What you can do:**
- Search customers by any field
- Add new customers manually
- Edit customer info
- Send messages (WhatsApp, Email, SMS)
- View geographic analytics

**Tabs:**
1. **Customer Directory** - Full customer list
2. **Location Analytics** - Geographic insights

---

### B. Customer Insights (`/customer-insights`)

Advanced analytics with 4 specialized views:

#### Tab 1: RFM Analysis
- See customer segments (Champions, At Risk, Dormant, etc.)
- Understand each customer's: Recency, Frequency, Spending
- Sort by segment to take targeted actions

**Example Use:**
- Champions → VIP treatment, exclusive offers
- At Risk → Win-back campaign, special discount
- Dormant → Re-engagement email series

#### Tab 2: Customer Lifetime Value (CLV)
- See predicted 2-year value for each customer
- Tier system: Platinum > Gold > Silver > Bronze > Standard
- Identify top 50 customers worth investing in

**Example Use:**
- Platinum customers → Dedicated account manager
- Gold customers → Early product access
- Others → Standard service

#### Tab 3: Churn Risk
- Red flag: High/Critical risk customers
- Know exactly how many days since last purchase
- Get churn score (0-100)

**Example Use:**
- Critical (>365 days): Aggressive win-back
- High (180-365 days): Special offer
- Medium (60-180 days): Check-in email
- Safe/Low: Keep normal engagement

#### Tab 4: Loyalty
- See VIP Loyal (10+ orders, Rs.50K+ spent)
- Regular Loyal (5+ orders, 3+ months active)
- Track delivery reliability

**Example Use:**
- VIP Loyal → Loyalty rewards program
- Regular Loyal → Referral bonus
- Good reliability → Trust messaging in ads

---

## Step 3: Use the Data for Actions

### Finding Opportunities

**Want to upsell?**
→ Go to `/customer-insights` → CLV tab → Top customers by predicted value

**Want to prevent churn?**
→ Go to `/customer-insights` → Churn Risk tab → Filter by "Critical"

**Want to grow in a region?**
→ Go to `/customers` → Location Analytics → Top states/cities

**Want to launch loyalty program?**
→ Go to `/customer-insights` → Loyalty tab → VIP Loyal customers

---

## Step 4: Upcoming Features (Roadmap)

Currently implemented:
- ✓ RFM segmentation
- ✓ CLV prediction
- ✓ Churn risk detection
- ✓ Loyalty tracking
- ✓ Geographic analytics

Coming soon:
- [ ] Automated email campaigns by segment
- [ ] WhatsApp bulk messaging
- [ ] Customer cohort analysis
- [ ] Repeat purchase prediction
- [ ] Geographic heat maps
- [ ] Brand performance dashboard
- [ ] Seasonal trend analysis

---

## Key Metrics Explained

### RFM Score
```
Score = (Recency_percentile × 100) + (Frequency_percentile × 10) + Monetary_percentile
Range: 0-444
Higher = Better customer
```

### Churn Risk
```
Risk = Days_inactive + (1 - Purchase_frequency) + (-Lifetime_value)
0-20: Safe (still engaged)
20-50: Low (minor concern)
50-70: Medium (watch closely)
70-85: High (urgent action needed)
85-100: Critical (lost customer)
```

### Customer Lifetime Value
```
CLV = Avg_order_value × Orders_per_month × 24 months
Assumes customer maintains current purchase pattern
```

### Loyalty Tier
```
VIP Loyal: 10+ orders AND Rs.50,000+ spent
Regular Loyal: 5+ orders AND 3+ months active
Occasional: 3+ orders
One-Time: 1 order
```

---

## Database Info

**Customers Table:** 500+ records
**Orders Table:** 2000+ records
**Data Freshness:** Last updated during import
**Sales Channels Included:**
1. Halte Website
2. JH Website
3. JSPL Marketplace
4. JSPL B2B
5. Self-Ship Channel

---

## Tips & Tricks

1. **Search tip:** Use postal code in customer search to find neighbors
2. **Bulk messaging:** Export customer phone numbers from analytics, use WhatsApp Business API
3. **Seasonal planning:** Check purchase dates to plan inventory
4. **New markets:** Look at geographic spread to find growth opportunities
5. **Quality check:** Delivery reliability shows fulfillment quality by brand

---

## Troubleshooting

**Q: Customer data not loading?**
- Check if import script ran successfully
- Verify database connection
- Run: `SELECT COUNT(*) FROM customers;`

**Q: Analytics page empty?**
- Wait 30 seconds after import (indexes building)
- Check browser console for errors
- Try refreshing page

**Q: Some customers missing?**
- Manual CSV edits needed if data was incomplete
- Check import script warnings for skipped rows

---

## Next Steps

1. ✓ Run import: `python import_customer_data.py`
2. ✓ Visit `/customers` to browse data
3. ✓ Visit `/customer-insights` to explore analytics
4. ✓ Use findings to make business decisions
5. → Contact support for custom reports

Happy analyzing!
