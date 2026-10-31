// GitHub confirmation for repos linked from X posts: stars, forks, watchers and release
// downloads show whether people actually use a project, not only like the post about it.
// No discovery happens here; X finds the projects. One GraphQL request covers 50 repos,
// and GraphQL follows renames and transfers.

const API = "https://api.github.com/graphql";
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function graphql(token, query, log) {
  for (let attempt = 0; attempt < 4; attempt++) {
    let res;
    try {
      res = await fetch(API, { method: "POST", body: JSON.stringify({ query }), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } });
    } catch {
      await sleep(2 ** attempt * 1000);
      continue;
    }
    if (res.ok) return res.json();
    if (res.status === 401) throw new Error("GitHub rejected the token (401).");
    if (res.status >= 500 || res.status === 403 || res.status === 429) { await sleep(2 ** attempt * 2000); continue; }
    log(`GitHub HTTP ${res.status}`, "warn");
    return null;
  }
  return null;
}

const FIELDS = `nameWithOwner url description isArchived isFork pushedAt createdAt stargazerCount forkCount
  watchers { totalCount } licenseInfo { spdxId } primaryLanguage { name }
  releases(first: 10, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { releaseAssets(first: 30) { nodes { downloadCount } } } }`;

// Returns Map name -> stats, or { status: "gone" } for deleted, private or blocked repos.
// Repos missing from the map couldn't be checked this run.
export async function repoStats(token, names, log) {
  const out = new Map();
  for (let i = 0; i < names.length; i += 50) {
    const batch = names.slice(i, i + 50);
    const fields = batch.map((n, j) => {
      const [owner, name] = n.split("/");
      return `r${j}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${FIELDS} }`;
    });
    const res = await graphql(token, `query { ${fields.join("\n")} }`, log);
    if (!res?.data) continue;
    const errs = new Map((res.errors || []).map(e => [e.path?.[0], e.type || e.message]));
    batch.forEach((n, j) => {
      const r = res.data[`r${j}`];
      if (!r) return errs.has(`r${j}`) && out.set(n, { status: "gone", reason: errs.get(`r${j}`) });
      out.set(n, {
        status: r.isArchived ? "archived" : "ok",
        repo: r.nameWithOwner,
        url: r.url,
        description: r.description || "",
        fork: r.isFork,
        stars: r.stargazerCount,
        forks: r.forkCount,
        watchers: r.watchers?.totalCount || 0,
        releases: r.releases?.totalCount || 0,
        downloads: (r.releases?.nodes || []).reduce((s, rel) => s + (rel?.releaseAssets?.nodes || []).reduce((t, a) => t + (a?.downloadCount || 0), 0), 0),
        license: r.licenseInfo?.spdxId || "",
        language: r.primaryLanguage?.name || "",
        created: (r.createdAt || "").slice(0, 10),
        pushed_at: r.pushedAt,
      });
    });
  }
  return out;
}

// A screenshot for the card: the first real image in the repo's README. Badges, logos,
// icons, avatars and SVGs are skipped; relative paths point at the repo's files.
const SKIP_IMAGE = /shields\.io|badge|badgen|dcbadge|trendshift|codecov|travis-ci|circleci|\/workflows\/|buymeacoffee|ko-fi|star-history|contrib\.rocks|vercel\.com\/button|deploy|avatars?\b|\/logo|logo[\w-]*\.|icon[\w-]*\.|\.svg(\?|$)|^https?:\/\/github\.com\/[\w-]+\.png/i;

export function pickReadmeImage(md, repo) {
  const text = (md || "").replace(/&#x2F;/gi, "/").replace(/&amp;/g, "&");
  const found = [];
  for (const m of text.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<img\b[^>]*>/gi)) {
    if (m[2]) { found.push({ alt: m[1], src: m[2] }); continue; }
    const tag = m[0];
    const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] || "";
    const width = +(tag.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1] || 0);
    if (src && !(width && width < 200)) found.push({ alt, src });
  }
  for (const { alt, src } of found) {
    if (SKIP_IMAGE.test(src) || /\b(logo|icon|badge|avatar)\b/i.test(alt)) continue;
    if (/^https?:\/\//i.test(src)) return src.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/i, "https://raw.githubusercontent.com/$1/$2");
    if (/^(data:|#|mailto:)/i.test(src)) continue;
    return `https://raw.githubusercontent.com/${repo}/HEAD/${src.replace(/^\.?\//, "")}`;
  }
  return null;
}

// raw.githubusercontent.com isn't API rate limited. Returns the image URL, null when the
// README has none, or undefined when the README couldn't be fetched (try again later).
export async function readmeImage(repo) {
  for (const name of ["README.md", "readme.md", "Readme.md", "README.MD"]) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${name}`);
      if (res.ok) return pickReadmeImage(await res.text(), repo);
      if (res.status !== 404) return undefined;
    } catch { return undefined; }
  }
  return null;
}
