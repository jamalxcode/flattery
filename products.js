// Well-known commercial ("retail") software, for spotting reimplementations of it.
// [display name, vendor, alias regex source, optional search term]. Ambiguous names (Word, Teams, Pages…)
// only match with their vendor in front; names that are also plain words must be
// capitalised (see CAPITALISED).
export const PRODUCTS = [
  ["Photoshop", "Adobe", "(?:adobe\\s+)?photoshop"],
  ["Lightroom", "Adobe", "(?:adobe\\s+)?lightroom"],
  ["Illustrator", "Adobe", "adobe\\s+illustrator"],
  ["Premiere Pro", "Adobe", "(?:adobe\\s+)?premiere(?:\\s+pro)?"],
  ["After Effects", "Adobe", "(?:adobe\\s+)?after\\s+effects"],
  ["InDesign", "Adobe", "(?:adobe\\s+)?indesign"],
  ["Acrobat", "Adobe", "(?:adobe\\s+)?acrobat"],
  ["Audition", "Adobe", "adobe\\s+audition"],
  ["Dreamweaver", "Adobe", "(?:adobe\\s+)?dreamweaver"],
  ["Adobe XD", "Adobe", "adobe\\s+xd"],
  ["Word", "Microsoft", "(?:microsoft|ms)\\s+word"],
  ["Excel", "Microsoft", "(?:microsoft\\s+|ms\\s+)?excel"],
  ["PowerPoint", "Microsoft", "(?:microsoft\\s+|ms\\s+)?powerpoint"],
  ["Outlook", "Microsoft", "(?:microsoft\\s+|ms\\s+)?outlook"],
  ["OneNote", "Microsoft", "(?:microsoft\\s+)?onenote"],
  ["Teams", "Microsoft", "(?:microsoft|ms)\\s+teams"],
  ["Visio", "Microsoft", "(?:microsoft\\s+)?visio"],
  ["Access", "Microsoft", "(?:microsoft|ms)\\s+access"],
  ["Power BI", "Microsoft", "power\\s?bi"],
  ["Final Cut Pro", "Apple", "final\\s+cut(?:\\s+pro)?"],
  ["Logic Pro", "Apple", "logic\\s+pro"],
  ["Keynote", "Apple", "(?:apple\\s+)?keynote"],
  ["Pages", "Apple", "apple\\s+pages"],
  ["Numbers", "Apple", "apple\\s+numbers"],
  ["GarageBand", "Apple", "garage\\s?band"],
  ["iMovie", "Apple", "imovie"],
  ["AutoCAD", "Autodesk", "(?:autodesk\\s+)?autocad"],
  ["Maya", "Autodesk", "autodesk\\s+maya"],
  ["3ds Max", "Autodesk", "3ds\\s?max"],
  ["Fusion 360", "Autodesk", "fusion\\s?360"],
  ["Revit", "Autodesk", "(?:autodesk\\s+)?revit"],
  ["SolidWorks", "Dassault", "solid\\s?works"],
  ["Figma", "Figma", "figma"],
  ["Sketch", "Sketch", "sketch\\s+app|bohemian\\s+sketch", "Sketch app"],
  ["Canva", "Canva", "canva"],
  ["Affinity Photo", "Serif", "affinity\\s+(?:photo|designer|publisher)"],
  ["CorelDRAW", "Corel", "corel\\s?draw"],
  ["Procreate", "Savage", "procreate"],
  ["DaVinci Resolve", "Blackmagic", "davinci\\s+resolve"],
  ["CapCut", "ByteDance", "capcut"],
  ["Ableton Live", "Ableton", "ableton(?:\\s+live)?"],
  ["FL Studio", "Image-Line", "fl\\s+studio"],
  ["Pro Tools", "Avid", "pro\\s?tools"],
  ["Cubase", "Steinberg", "cubase"],
  ["Sibelius", "Avid", "sibelius"],
  ["Notion", "Notion", "notion(?:\\.so)?"],
  ["Obsidian", "Obsidian", "obsidian(?:\\.md)?"],
  ["Evernote", "Evernote", "evernote"],
  ["Slack", "Salesforce", "slack"],
  ["Discord", "Discord", "discord"],
  ["Zoom", "Zoom", "zoom"],
  ["Trello", "Atlassian", "trello"],
  ["Jira", "Atlassian", "jira"],
  ["Confluence", "Atlassian", "confluence"],
  ["Asana", "Asana", "asana"],
  ["Linear", "Linear", "linear\\.app|linear\\s+app"],
  ["Airtable", "Airtable", "airtable"],
  ["Miro", "Miro", "miro"],
  ["Loom", "Loom", "loom"],
  ["Calendly", "Calendly", "calendly"],
  ["Typeform", "Typeform", "typeform"],
  ["Zapier", "Zapier", "zapier"],
  ["Postman", "Postman", "postman"],
  ["Tableau", "Salesforce", "tableau"],
  ["Salesforce", "Salesforce", "salesforce"],
  ["QuickBooks", "Intuit", "quickbooks"],
  ["Shopify", "Shopify", "shopify"],
  ["Squarespace", "Squarespace", "squarespace"],
  ["Webflow", "Webflow", "webflow"],
  ["Framer", "Framer", "framer"],
  ["Grammarly", "Grammarly", "grammarly"],
  ["1Password", "AgileBits", "1password"],
  ["Dropbox", "Dropbox", "dropbox"],
  ["Google Docs", "Google", "google\\s+docs"],
  ["Google Sheets", "Google", "google\\s+sheets"],
  ["Spotify", "Spotify", "spotify"],
  ["MATLAB", "MathWorks", "matlab"],
  ["Mathematica", "Wolfram", "mathematica"],
  ["Claude Code", "Anthropic", "claude\\s+code"],
  ["Cursor", "Anysphere", "cursor\\s+(?:ide|editor|ai)"],
  ["ChatGPT", "OpenAI", "chatgpt"],
];

const CAPITALISED = new Set(["Excel", "Outlook", "Keynote", "Canva", "Notion", "Obsidian", "Slack", "Discord", "Zoom",
  "Confluence", "Asana", "Miro", "Loom", "Postman", "Tableau", "Framer", "Spotify", "Sibelius", "Revit"]);

// A product counts only when the text says the project reimplements it: "clean-room
// reimplementation of Adobe Photoshop", "Figma alternative", "a Notion clone"…
const BEFORE = "(?:re-?implementation|re-?write|re-?build|clone|alternative|replacement|replica|recreation|remake|port|take)s?\\s+(?:of|to|for|on)\\s+(?:the\\s+)?(?:open[- ]source\\s+)?";
const AFTER = "(?:\\s+|-)(?:clone|alternative|replacement|killer|re-?implementation|compatible)\\b";
const MATCHERS = PRODUCTS.map(([name, vendor, alias]) => ({
  name, vendor,
  capitalised: CAPITALISED.has(name),
  rx: new RegExp(`${BEFORE}(${alias})\\b|\\b(?:open[- ]source\\s+)?(${alias})${AFTER}`, "gi"),
}));

// Looks at the description and the top of the README only, where a project says what it
// is; that keeps lists ("awesome-…") that mention many products further down from matching.
export function detectProduct(description, readme) {
  const head = (description || "") + "\n" + (readme || "").slice(0, 3000).replace(/<[^>]+>/g, " ");
  let best = null;
  for (const m of MATCHERS) {
    let n = 0;
    for (const x of head.matchAll(m.rx)) {
      const name = x[1] || x[2];
      if (!m.capitalised || /^[A-Z]/.test(name)) n++;
    }
    if (n && (!best || n > best.n)) best = { name: m.name, vendor: m.vendor, n };
  }
  return best && { name: best.name, vendor: best.vendor };
}

// Repo-search queries for one product, for rotating discovery.
const TEMPLATES = ['"{p}" reimplementation in:description,readme', '"{p}" clone in:description', '"{p}" alternative in:description'];
// Names that need their vendor to match ("Microsoft Word") are searched with it.
export const PRODUCT_QUERIES = PRODUCTS.flatMap(([name, vendor, alias, search]) => {
  const term = search || (new RegExp(`^(?:${alias})$`, "i").test(name) ? name : `${vendor} ${name}`);
  return TEMPLATES.map(t => ({ product: name, q: t.replace("{p}", term) }));
});
