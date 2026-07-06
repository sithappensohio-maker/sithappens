# Register quantity/order fixes

- Register → Sell Credits now supports a quantity field. Selling 5 single-day packs creates 5 credit lots and adds 5 credits; selling 2 ten-packs adds 20 credits.
- The credit order total shows before sale: quantity × pack price, plus total credits added.
- Register → New Sale now supports quantity + price each for items like two leashes, while still allowing a simple one-off amount for deposits/misc services.
- Retail sales now store quantity and unit_price for audit/receipts while keeping amount as the money source of truth.
- Bulk credit-pack receipts now use the effective/legacy pack price when applicable.
- No existing clients, dogs, credits, bookings, or balances are changed.
