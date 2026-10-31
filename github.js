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

const fields = since => `nameWithOwner url homepageUrl owner { __typename avatarUrl(size: 160) } description isArchived isFork pushedAt createdAt stargazerCount forkCount
  watchers { totalCount } licenseInfo { spdxId } primaryLanguage { name }
  defaultBranchRef { target { ... on Commit { history(since: "${since}") { totalCount } } } }
  releases(first: 10, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { tagName releaseAssets(first: 30) { nodes { name downloadCount } } } }`;

// Which systems a release can be installed on, from its file names
export function platformsOf(names) {
  const has = re => names.some(n => re.test(n));
  return [
    has(/\.(dmg|pkg)$|mac|darwin|osx|\.app\.(zip|tar)/i) && "Mac",
    has(/\.(exe|msi|msix|appx)$|win(dows)?[-_.]|[-_.]win(64|32)?\b/i) && "Windows",
    has(/\.(appimage|deb|rpm|snap|flatpak)$|linux/i) && "Linux",
    has(/\.apk$|android/i) && "Android",
    has(/\.ipa$/i) && "iOS",
  ].filter(Boolean);
}

// The file to download for each system, from the newest release that has one: { Mac: url, … }.
// Prefers installers (dmg, exe/msi, AppImage/deb) over archives, and skips checksums and sources.
export function downloadsOf(releases, repo) {
  const out = {};
  const RANK = {
    Mac: [/\.dmg$/i, /\.pkg$/i, /(mac|darwin|osx).*\.zip$/i],
    Windows: [/\.exe$/i, /\.msi$/i, /\.msix$/i, /win(dows)?.*\.zip$/i],
    Linux: [/\.appimage$/i, /\.deb$/i, /\.rpm$/i, /linux.*\.(tar\.gz|zip)$/i],
    Android: [/\.apk$/i],
  };
  for (const rel of releases || []) {
    // A release file's address: github.com/<repo>/releases/download/<tag>/<file>
    const url = name => `https://github.com/${repo}/releases/download/${encodeURIComponent(rel.tagName)}/${encodeURIComponent(name)}`;
    const assets = (rel?.tagName ? rel.releaseAssets?.nodes || [] : []).filter(a => a?.name && !/\.(sha\d*|sig|asc|blockmap|ya?ml|txt|json)$|source|symbols|debug/i.test(a.name || ""));
    for (const [os, tests] of Object.entries(RANK)) {
      if (out[os]) continue;
      for (const re of tests) {
        // Mac builds for Apple chips over Intel ones when both exist
        const hits = assets.filter(a => re.test(a.name)).sort((x, y) => /arm64|aarch64|universal/i.test(y.name) - /arm64|aarch64|universal/i.test(x.name));
        if (hits.length) { out[os] = url(hits[0].name); break; }
      }
    }
  }
  return out;
}

// Returns Map name -> stats, or { status: "gone" } for deleted, private or blocked repos.
// Repos missing from the map couldn't be checked this run.
export async function repoStats(token, names, log) {
  const out = new Map();
  for (let i = 0; i < names.length; i += 50) {
    const batch = names.slice(i, i + 50);
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const parts = batch.map((n, j) => {
      const [owner, name] = n.split("/");
      return `r${j}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { ${fields(since)} }`;
    });
    const res = await graphql(token, `query { ${parts.join("\n")} }`, log);
    // A mistake in the query itself fails every repo: say so in the log, never silently
    if (!res?.data) { log(`GitHub query failed: ${(res?.errors || []).map(e => e.message).join("; ").slice(0, 300) || "no data"}`, "warn"); continue; }
    // Errors on parts of the answer (one repo, one field) leave the rest usable: log them
    const partial = (res.errors || []).filter(e => !/NOT_FOUND|FORBIDDEN/.test(e.type || ""));
    if (partial.length) log(`GitHub query: ${partial.length} errors, e.g. ${partial[0].message.slice(0, 200)}`, "warn");
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
        get: downloadsOf(r.releases?.nodes, r.nameWithOwner),
        org_avatar: r.owner?.__typename === "Organization" ? r.owner.avatarUrl || "" : "",
        platforms: platformsOf((r.releases?.nodes || []).flatMap(rel => (rel?.releaseAssets?.nodes || []).map(a => a?.name || ""))),
        homepage: /^https?:\/\//.test(r.homepageUrl || "") && !/github\.com/.test(r.homepageUrl) ? r.homepageUrl : "",
        commits_30d: r.defaultBranchRef?.target?.history?.totalCount ?? null,
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

// An icon for the row: a logo near the top of the README (an image named or labelled logo or
// icon, or a small image before the first heading's text). Badges are skipped.
const BADGE = /shields\.io|badge|badgen|dcbadge|trendshift|codecov|travis-ci|circleci|\/workflows\/|buymeacoffee|ko-fi|star-history|contrib\.rocks|vercel\.com\/button|producthunt|deploy/i;
const absolute = (src, repo) => /^https?:\/\//i.test(src)
  ? src.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/(.+)$/i, "https://raw.githubusercontent.com/$1/$2")
  : /^(data:|#|mailto:)/i.test(src) ? null : `https://raw.githubusercontent.com/${repo}/HEAD/${src.replace(/^\.?\//, "")}`;
export function pickReadmeLogo(md, repo) {
  const text = (md || "").replace(/&#x2F;/gi, "/").replace(/&amp;/g, "&").slice(0, 3000);
  for (const m of text.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)|<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = m[2] || tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    const alt = m[1] ?? tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
    const width = +(tag.match(/\bwidth\s*=\s*["']?(\d+)/i)?.[1] || 0);
    const height = +(tag.match(/\bheight\s*=\s*["']?(\d+)/i)?.[1] || 0);
    if (!src || BADGE.test(src)) continue;
    const named = /logo|icon|favicon|app[-_]?icon/i.test(src) || /\b(logo|icon)\b/i.test(alt);
    const small = (width && width <= 260) && (!height || height <= 260);
    if (named || small) return absolute(src, repo);
  }
  return null;
}

// raw.githubusercontent.com isn't API rate limited. Returns { image, logo } (each null when the
// README has none), or undefined when the README couldn't be fetched (try again later).
export async function readmeImage(repo) {
  for (const name of ["README.md", "readme.md", "Readme.md", "README.MD"]) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${repo}/HEAD/${name}`);
      if (res.ok) { const md = await res.text(); return { image: pickReadmeImage(md, repo), logo: pickReadmeLogo(md, repo) }; }
      if (res.status !== 404) return undefined;
    } catch { return undefined; }
  }
  return null;
}
