# Customer Features Guide

## Overview

Your HalteDB system now includes comprehensive customer analytics, insights, and management features powered by real customer data imported from your sales channels.

## New Features

### 1. Customer Data Import

**File:** `import_customer_data.py`

Automatically imports customer data from multiple CSV sources:
- Halte Website orders
- JH Website orders  
- JSPL Marketplace orders
- JSPL B2B orders
- Self-ship channel orders

**What it does:**
- Consolidates customers across all sales channels
- Eliminates duplicate customer records
- Normalizes phone numbers and state names
- Calculates total orders and lifetime spending
- Generates automatic customer segments

**To run:**
```bash
python import_customer_data.py
```

**Output:**
- Loads all customer records into `customers` table
- Loads all order records into `orders` table
- Generates customer segments (VIP, Premium, Loyal, Regular)

---

### 2. Customer RFM Analysis

**Endpoint:** `GET /api/customers/analytics?metric=rfm`

RFM (Recency, Frequency, Monetary) is a proven model for customer segmentation.

**Segments:**
- **Champions:** Recent, frequent, high-value customers
- **Loyal Customers:** Established repeat buyers
- **New Customers:** Recent purchases, low frequency
- **Big Spenders:** High value regardless of frequency
- **At Risk:** Haven't purchased recently but were valuable
- **Dormant:** No purchases in 180+ days
- **Standard:** Other customers

**Use Case:**
- Identify who to focus retention efforts on
- Prioritize marketing spend
- Tailor messaging by segment

---

### 3. Customer Lifetime Value (CLV)

**Endpoint:** `GET /api/customers/analytics?metric=clv`

Predicts long-term customer value based on purchase patterns.

**Tiers:**
- **Platinum:** Rs.50,000+ total spent + 180+ day tenure
- **Gold:** Rs.30,000+ total spent
- **Silver:** Rs.10,000+ total spent
- **Bronze:** Rs.5,000+ total spent
- **Standard:** Below Rs.5,000

**Calculation:**
```
Predicted CLV = Average Order Value × Purchase Frequency/month × 24 months
```

**Use Case:**
- Know which customers are worth investing in
- Make personalized offer decisions
- Plan customer acquisition budgets

---

### 4. Churn Risk Prediction

**Endpoint:** `GET /api/customers/analytics?metric=churn`

Identifies customers at risk of churning based on inactivity and patterns.

**Risk Categories:**
- **Critical:** >365 days inactive (score: 100)
- **High:** 180-365 days inactive (score: 85)
- **Medium:** 60-90 days inactive + low frequency (score: 50-70)
- **Low:** Recent activity or consistent purchases
- **Safe:** Active customers with good frequency

**Use Case:**
- Launch targeted win-back campaigns
- Adjust support/communication strategy
- Prevent high-value customer loss

---

### 5. Loyalty Analysis

**Endpoint:** `GET /api/customers/analytics?metric=loyalty`

Identifies repeat customers and purchase patterns.

**Loyalty Tiers:**
- **VIP Loyal:** 10+ orders AND Rs.50,000+ spent
- **Regular Loyal:** 5+ orders AND 3+ months active
- **Occasional Repeat:** 3+ orders
- **One-Time:** Single purchase

**Reliability Rating:**
- **Excellent:** 95%+ delivery success
- **Good:** 85%+ delivery success
- **Fair:** <85% delivery success

**Use Case:**
- Recognize and reward loyal customers
- Identify high-frequency buyers for upselling
- Track delivery/fulfillment quality impact

---

## Dashboard Pages

### 1. Customers Directory (`/customers`)

**Features:**
- Browse all customers with full details
- Search by name, phone, email, city, state
- View total orders and spending per customer
- Last order date tracking
- Quick messaging (WhatsApp, Email, SMS)
- Edit customer information
- Delete customer records

**Analytics Sections:**
- Top buying locations (by postal code)
- Repeat buyer locations (multiple orders)
- Revenue by state
- New buyer locations trend
- State-wise summary

---

### 2. Customer Insights (`/customer-insights`)

Advanced analytics dashboard with 4 tabs:

#### RFM Analysis Tab
- Customer segmentation view
- Count by segment type
- Searchable customer table with RFM scores
- Sort by segment to identify opportunity groups

#### CLV Tab
- Average customer lifetime value (2-year projection)
- Total customers analyzed
- Tier distribution (Platinum/Gold/Silver/Bronze)
- Top customers by predicted value

#### Churn Risk Tab
- At-risk customer count and percentage
- Distribution across risk categories
- High-risk customer list (score > 60)
- Recommended actions by category

#### Loyalty Tab
- VIP Loyal customer count
- Regular Loyal customer count
- Total loyal customer base
- Loyalty tier breakdown
- Delivery reliability ratings

---

## API Reference

### Base Endpoint
```
GET /api/customers/analytics?metric={metric}
```

### Query Parameters
- `metric` (required): `rfm`, `clv`, `churn`, or `loyalty`

### Response Structure

#### RFM Response
```json
{
  "customers": [
    {
      "customer_id": "CUST-0001",
      "name": "John Doe",
      "phone": "919876543210",
      "email": "john@example.com",
      "state": "Delhi",
      "days_since_order": 30,
      "purchase_frequency": 5,
      "total_spent": 25000,
      "rfm_score": 430,
      "segment": "Champions"
    }
  ],
  "segmentCounts": {
    "Champions": 45,
    "Loyal": 120,
    "At Risk": 35
  },
  "totalCustomers": 542
}
```

#### CLV Response
```json
{
  "customers": [
    {
      "customer_id": "CUST-0001",
      "name": "John Doe",
      "total_orders": 8,
      "total_spent": 45000,
      "avg_order_value": 5625,
      "predicted_clv": 135000,
      "tier": "Platinum"
    }
  ],
  "avgCLV": 28500,
  "totalCustomers": 250
}
```

---

## Database Tables

### customers
```sql
- customer_id (PK): CUST-0001 format
- name: Customer name
- phone: 10-digit phone
- email: Email address
- address: Street address
- city: City name
- state: State/Province
- pincode: Postal code
- total_orders: Count of orders
- total_spent: Sum of order values
- last_order_date: Timestamp
- notes: Customer segment or notes
- created_at: Import date
- updated_at: Last update
```

### orders
```sql
- id (PK)
- amazon_order_id: Unique order ID
- purchase_date: Order date
- last_updated_date: Last update
- order_status: Delivery status
- fulfillment_channel: MFN/FBA
- sales_channel: Source (website/amz/b2b)
- sku: Product SKU
- asin: Amazon ASIN
- item_status: Order item status
- quantity: Units ordered
- currency: Currency (INR)
- item_price: Total order value
- item_tax: Tax amount
- ship_city: Delivery city
- ship_state: Delivery state
- ship_postal_code: Delivery pincode
```

---

## Data Quality

The import script:
- Handles multiple date formats automatically
- Normalizes Indian phone numbers (10 digits)
- Maps state abbreviations to full names
- Removes duplicate orders via unique constraints
- Cleans whitespace and special characters
- Parses Indian number format (with commas)

---

## Usage Examples

### Find VIP Customers to Contact
```typescript
// In Customer Insights > RFM Analysis
// Filter segment = "Champions"
// Ideal for: exclusive offers, early access, VIP events
```

### Identify At-Risk High-Value Customers
```typescript
// In Customer Insights > Churn Risk
// Filter: churn_category = "High" AND total_spent > 50000
// Action: Personalized outreach, special discounts
```

### Find Repeat Buyers for Loyalty Program
```typescript
// In Customer Insights > Loyalty
// Filter: loyalty_tier = "VIP Loyal"
// Action: Enroll in rewards program, dedicated support
```

### Geographic Expansion Opportunities
```typescript
// In Customers > Analytics > Top Locations
// Identify high-revenue states/cities with few customers
// Action: Targeted ads, localized marketing
```

---

## Performance Notes

- RFM calculation uses SQL window functions (fast)
- CLV prediction based on historical patterns
- Churn risk uses 60-365 day windows
- All queries optimized with indexes on customer_id, state, purchase_date

---

## Future Enhancements

- Machine learning churn prediction
- Cohort analysis by acquisition channel
- Customer journey mapping
- Automated win-back email campaigns
- Referral tracking
- Net Promoter Score (NPS) integration
- Geographic heat mapping
- Seasonal trend analysis
