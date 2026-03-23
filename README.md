# Walmart Listing MCP

Standalone MCP server for Walmart listing workflows only.

Current scope:

- seller profile management
- credential verification
- items
- item status / retire
- feeds
- taxonomy / departments
- inventory
- price
- direct listing API invocation for listing-related endpoints only

Not included in this version:

- orders
- returns
- WFS
- Walmart Connect ads
- reconciliation / finance reports

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure credentials with either:

- `.env`
- or MCP tools such as `walmart_upsert_seller_profile`

Example `.env`:

```env
WALMART_CLIENT_ID=your_client_id
WALMART_CLIENT_SECRET=your_client_secret
WALMART_MARKETPLACE=US
WALMART_SANDBOX=false
```

3. Build and run:

```bash
npm run build
npm start
```

## Main Tools

- `walmart_upsert_seller_profile`
- `walmart_list_seller_profiles`
- `walmart_set_active_seller_profile`
- `walmart_get_token_status`
- `walmart_verify_credentials`
- `walmart_invoke_listing_api`
- `walmart_get_items`
- `walmart_get_item`
- `walmart_get_item_status`
- `walmart_retire_item`
- `walmart_submit_feed`
- `walmart_get_feed_status`
- `walmart_get_feeds`
- `walmart_get_taxonomy`
- `walmart_get_departments`
- `walmart_get_inventory`
- `walmart_get_bulk_inventory`
- `walmart_update_inventory`
- `walmart_update_price`

## Notes

- Seller profiles are stored locally in `.walmart-seller-profiles.json`.
- `walmart_invoke_listing_api` is restricted to:
  - `/v3/items`
  - `/v3/inventory`
  - `/v3/price`
  - `/v3/feeds`
  - `/v3/utilities/taxonomy`
- Access tokens are cached in memory per profile or credential set.
