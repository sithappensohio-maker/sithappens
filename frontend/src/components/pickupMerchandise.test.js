/* Selling a bag of food while the dog is being collected.
 *
 * The design decision this pins: merchandise at pickup is NOT an add-on
 * service on the booking. It rings through the Register's own sale, so stock,
 * sales tax, retail revenue and idempotency stay where they already work.
 * If this screen ever starts pricing products onto the stay, that is a second
 * till, and these tests should fail. */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "CheckoutModal.jsx"), "utf8");

test("products come from the register's own catalog, not a second list", () => {
  expect(src).toMatch(/api\.get\("\/pos\/catalog"/);
  // priced for THIS client, so a grandfathered rate is honoured at pickup too
  expect(src).toMatch(/booking\.client_id \? \{ client_id: booking\.client_id \} : \{\}/);
});

test("only physical products are offered, and only if they are in stock", () => {
  expect(src).toMatch(/it\.kind === "product" && it\.in_stock/);
  // credit packs and training programs are services and belong in the
  // Register; the filter admits products and nothing else
  const load = src.slice(src.indexOf('api.get("/pos/catalog"'));
  const filter = load.slice(0, load.indexOf("setShopItems") + 200);
  expect(filter).not.toMatch(/credit_pack|training_program/);
});

test("merchandise rides the retail path, never the booking's add-ons", () => {
  expect(src).toMatch(/body\.retail_lines = shopLines\.map/);
  expect(src).toMatch(/kind: "retail", product_id: l\.item\.id, qty: l\.qty/);
  // the add-on cart is a separate thing and stays separate
  const submit = src.slice(src.indexOf("const submit = async"), src.indexOf("const field ="));
  expect(submit).toMatch(/add_ons: cartItems\.map/);
  expect(submit).not.toMatch(/add_ons:.*shopLines/);
});

test("a retry cannot sell the same bag of food twice", () => {
  expect(src).toMatch(/const \[retailKey\] = useState/);
  expect(src).toMatch(/body\.retail_idempotency_key = retailKey/);
});

test("merchandise always takes real money", () => {
  // Whatever the stay is doing — credits, a tab — goods are paid for.
  const submit = src.slice(src.indexOf("const submit = async"), src.indexOf("const field ="));
  const block = submit.slice(submit.indexOf("if (shopLines.length)"));
  expect(block).toMatch(/body\.payment_method = payMethod/);
});

test("the counter sees one number, with the split spelled out", () => {
  expect(src).toMatch(/const dueToday = Math\.round\(\(chargedToday \+ shopTotal\) \* 100\) \/ 100/);
  expect(src).toMatch(/data-testid="checkout-total">\$\{dueToday\.toFixed\(2\)\}/);
  expect(src).toContain('data-testid="checkout-total-split"');
  expect(src).toMatch(/stay \$\{chargedToday\.toFixed\(2\)\} \+ shop \$\{shopTotal\.toFixed\(2\)\}/);
});

test("tax is charged on the goods even though the stay is never taxed", () => {
  // salesTaxCfg.applies is always false now (a stay is a service), so the
  // basket must read the configured RATE rather than the booking's answer.
  expect(src).toMatch(/const salesTaxRateRaw = salesTaxCfg\.enabled \? Math\.max\(0, Number\(salesTaxCfg\.rate_pct \|\| 0\)\) : 0/);
  expect(src).toMatch(/shopLines\.reduce\(\(n, l\) => n \+ \(l\.item\.taxable \? l\.item\.effective_price \* l\.qty : 0\), 0\)/);
  expect(src).toContain('data-testid="checkout-shop-tax"');
});

test("an untaxed basket of taxable goods says why", () => {
  expect(src).toContain('data-testid="checkout-shop-no-tax-notice"');
  expect(src).toMatch(/shopTaxable > 0 && salesTaxRateRaw === 0/);
  expect(src).toMatch(/Settings → Sales Tax/);
});

test("the shelf is folded away until it is wanted", () => {
  // Most pickups sell nothing; an open product list would push the actual
  // checkout down the screen on every single one.
  expect(src).toContain('data-testid="checkout-shop-toggle"');
  expect(src).toMatch(/\{\(shopOpen \|\| shopLines\.length > 0\) && \(/);
  expect(src).toMatch(/max-h-\[240px\] overflow-y-auto/);
});

test("the screen is honest that the Register did the selling", () => {
  expect(src).toMatch(/Rung through the Register, so stock and sales tax are handled there/);
});
