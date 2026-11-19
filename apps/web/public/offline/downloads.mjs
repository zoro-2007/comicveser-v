import {
  DOWNLOADS_PATH, deleteDownload, getDownload, installOfflineWorker, listDownloads, localImagePath,
} from "./storage.mjs";

const main = document.querySelector("#content");
const header = document.querySelector("#site-header");
const status = document.querySelector("#connection");
const home = document.querySelector("#home-link");

function element(tag, { cls, text, attrs = {} } = {}, ...children) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function updateConnection() {
  status.dataset.online = String(navigator.onLine);
  status.textContent = navigator.onLine ? "Online" : "Offline";
  if (navigator.onLine) home.setAttribute("href", "/");
  else home.removeAttribute("href");
}
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);
updateConnection();
if (navigator.onLine) void installOfflineWorker().catch(() => {});

function href(comic, chapter) {
  const query = new URLSearchParams();
  if (comic) query.set("comic", comic);
  if (chapter) query.set("chapter", chapter);
  return query.size ? DOWNLOADS_PATH + "?" + query : DOWNLOADS_PATH;
}
const link = (text, url, cls = "link") => element("a", { cls, text, attrs: { href: url } });

function intro(label, title, detail, back) {
  main.replaceChildren(
    ...(back ? [back] : []),
    element("p", { cls: "eyebrow", text: label }),
    element("h1", { text: title }),
    element("p", { cls: "muted", text: detail }),
  );
}
function message(title, description) {
  intro("On this device", "Downloads", description);
  const note = element("div", { cls: "notice" }, element("h2", { text: title }));
  if (navigator.onLine) note.append(link("Browse ComicVerse", "/browse"));
  main.append(note);
}
function group(entries) {
  const comics = new Map();
  for (const entry of entries.sort((a, b) => b.savedAt - a.savedAt)) {
    if (!comics.has(entry.comicId)) comics.set(entry.comicId, []);
    comics.get(entry.comicId).push(entry);
  }
  return comics;
}
function showLibrary(entries) {
  if (!entries.length) {
    message("No chapters downloaded yet", "While online, open a published comic and download a chapter to save it here.");
    return;
  }
  intro("On this device", "Downloads", "Select a comic to see the chapters you can read without internet.");
  const grid = element("div", { cls: "grid" });
  for (const chapters of group(entries).values()) {
    const comic = chapters[0];
    const cover = chapters.find((chapter) => chapter.coverIndex === "cover") ?? comic;
    const img = element("img", { attrs: { src: localImagePath(cover.token, cover.coverIndex), alt: "", loading: "lazy" } });
    img.addEventListener("error", () => img.remove(), { once: true });
    const card = element("a", { cls: "card", attrs: { href: href(comic.comicId) } },
      element("div", { cls: "cover" }, img),
      element("h2", { text: comic.comicTitle }),
      element("p", { cls: "muted", text: `${chapters.length} downloaded ${chapters.length === 1 ? "chapter" : "chapters"}` }),
    );
    grid.append(card);
  }
  main.append(grid);
}
function showChapters(entries) {
  const comic = entries[0];
  intro("Downloaded chapters", comic.comicTitle, "Only chapters saved on this device appear here.",
    link("← All Downloads", DOWNLOADS_PATH, "link back"));
  const list = element("ul", { cls: "chapter-list" });
  const error = element("p", { cls: "inline-error", attrs: { role: "alert" } });
  for (const chapter of entries) {
    const name = `Chapter ${chapter.label}`;
    const read = element("a", { attrs: { href: href(comic.comicId, chapter.id) } },
      element("strong", { text: name }),
      element("small", { text: `${chapter.pages.length} pages${chapter.title && chapter.title !== name ? ` · ${chapter.title}` : ""}` }),
    );
    const remove = element("button", { cls: "delete", text: "Remove", attrs: { type: "button", "aria-label": `Remove downloaded chapter ${chapter.label}` } });
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remove ${name} from this device?`)) return;
      remove.disabled = true;
      error.textContent = "";
      try {
        await deleteDownload(chapter);
        const remaining = await listDownloads();
        const sameComic = ordered(remaining, comic.comicId);
        if (sameComic.length) showChapters(sameComic);
        else {
          history.replaceState(null, "", DOWNLOADS_PATH);
          showLibrary(remaining);
        }
      } catch {
        error.textContent = "Could not remove the chapter. Reload and try again.";
        remove.disabled = false;
      }
    });
    list.append(element("li", { cls: "chapter" }, read, remove));
  }
  main.append(list, error);
}
function ordered(entries, id) {
  return entries.filter((chapter) => chapter.comicId === id).sort((a, b) => a.number - b.number || a.id.localeCompare(b.id));
}

function showReader(chapter, entries) {
  document.title = `${chapter.comicTitle} · Chapter ${chapter.label} | ComicVerse`;
  document.body.classList.add("reader-mode");
  header.hidden = true;
  const back = href(chapter.comicId);
  const title = element("strong", { text: `${chapter.comicTitle} · Chapter ${chapter.label}` });
  const toolbar = element("div", { cls: "reader-bar reader-top", attrs: { id: "reader-controls", hidden: "" } },
    link("← Chapters", back), title);
  const settings = element("button", { cls: "controls-button reader-keys", text: "Show chapter controls", attrs: { type: "button", "aria-expanded": "false", "aria-controls": "reader-controls" } });
  const toggle = () => {
    toolbar.hidden = !toolbar.hidden;
    settings.setAttribute("aria-expanded", String(!toolbar.hidden));
    settings.textContent = toolbar.hidden ? "Show chapter controls" : "Hide chapter controls";
  };
  settings.addEventListener("click", toggle);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !toolbar.hidden) toggle();
  });

  const artwork = element("div", { cls: "artwork" });
  artwork.addEventListener("click", toggle);
  chapter.pages.forEach(({ width, height }, index) => {
    const img = element("img", { attrs: {
      src: localImagePath(chapter.token, index), alt: `Page ${index + 1}`,
      width: String(width), height: String(height), loading: index < 2 ? "eager" : "lazy",
      decoding: "async",
    } });
    img.addEventListener("error", () => {
      img.replaceWith(element("p", { cls: "broken", text: `Saved page ${index + 1} is missing. Remove and download this chapter again while online.` }));
    }, { once: true });
    artwork.append(img);
  });
  const index = entries.findIndex((entry) => entry.id === chapter.id);
  const nav = element("nav", { cls: "reader-bar reader-bottom", attrs: { "aria-label": "Downloaded chapters" } },
    ...(entries[index - 1] ? [link("← Previous", href(chapter.comicId, entries[index - 1].id), "controls-button")] : []),
    link("Back to chapters", back, "controls-button"),
    ...(entries[index + 1] ? [link("Next →", href(chapter.comicId, entries[index + 1].id), "controls-button")] : []),
  );
  main.replaceChildren(settings, toolbar, artwork, nav);
}

async function render() {
  try {
    const query = new URLSearchParams(location.search);
    const comic = query.get("comic");
    const id = query.get("chapter");
    const entries = await listDownloads();
    if (id) {
      const chapter = await getDownload(id);
      if (chapter && (!comic || chapter.comicId === comic)) {
        showReader(chapter, ordered(entries, chapter.comicId));
        return;
      }
    }
    const chapters = comic ? ordered(entries, comic) : [];
    if (chapters.length) showChapters(chapters);
    else showLibrary(entries);
  } catch {
    message("Downloads could not be opened", "Browser storage is unavailable. Check that site storage is enabled and reopen Downloads.");
  }
}
void render();
