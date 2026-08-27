import fs from "fs";
import path from "path";

const appSrc = fs.readFileSync(path.join(__dirname, "App.js"), "utf8");
const indexSrc = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const settingsSrc = fs.readFileSync(path.join(__dirname, "screens", "Settings.jsx"), "utf8");
const nginxSrc = fs.readFileSync(path.join(__dirname, "..", "nginx.conf"), "utf8");

test("React Router owns browser history instead of App keeping the active admin screen in useState", () => {
  expect(pkg.dependencies["react-router-dom"]).toBeTruthy();
  expect(indexSrc).toMatch(/<BrowserRouter>/);
  expect(appSrc).toMatch(/useLocation\(\)/);
  expect(appSrc).toMatch(/useNavigate\(\)/);
  expect(appSrc).toMatch(/parseAdminLocation\(location\.pathname, location\.search\)/);
  expect(appSrc).not.toMatch(/const \[tab, setTab\] = useState\(/);
});

test("public claim, certificate and shop URLs remain explicit routes", () => {
  expect(appSrc).toMatch(/<Route path="\/claim\/:token"/);
  expect(appSrc).toMatch(/<Route path="\/share\/cert\/:token"/);
  expect(appSrc).toMatch(/<Route path="\/shop\/\*"/);
  expect(appSrc).toMatch(/<Route path="\/admin\/\*"/);
  expect(appSrc).toMatch(/<Route path="\*" element=\{<AppProviders><Gate \/><\/AppProviders>\}/);
});

test("legacy sh:nav still works as a compatibility bridge but resolves through router navigation", () => {
  expect(appSrc).toMatch(/window\.addEventListener\("sh:nav", onNav\)/);
  expect(appSrc).toMatch(/const setTab = useCallback\(\(destination\) => navigateAdmin\(destination\)/);
});

test("record and workspace routing is wired into the existing screen contracts", () => {
  expect(appSrc).toMatch(/navigateAdmin\("dogs", \{kind:"dog", id, mode:"open"\}\)/);
  expect(appSrc).toMatch(/navigateAdmin\("clients", \{kind:"client", id, mode:"open"\}\)/);
  expect(appSrc).toMatch(/onSectionChange=\{\(section\)=>navigateAdmin\(SCHEDULE_TAB_BY_SECTION\[section\]/);
  expect(appSrc).toMatch(/onSectionChange=\{\(section\)=>navigateAdmin\(TRAINING_TAB_BY_SECTION\[section\]/);
  expect(settingsSrc).toMatch(/onSectionChange\(sub\.id\)/);
});


test("nginx keeps the SPA fallback required for direct-route refreshes", () => {
  expect(nginxSrc).toMatch(/try_files \$uri \$uri\/ \/index\.html;/);
});
