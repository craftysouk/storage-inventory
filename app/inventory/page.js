"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

/* =========================
   Cozy Stash Theme Tokens
========================= */
const THEME = {
  bg: "#F6F1E8", // warm cream
  card: "#FFFFFF",
  border: "#E8E2D9",
  text: "#3A322E",
  muted: "#7A6F69",
  accent: "#C47A5A", // terracotta
  accentSoft: "#E9CFC4",
  shadow: "0 10px 28px rgba(58,50,46,0.10)",
  shadowStrong: "0 14px 36px rgba(58,50,46,0.18)",
};

export default function InventoryPage() {
  const router = useRouter();

  const [session, setSession] = useState(null);

  // bottom nav tabs
  const [topTab, setTopTab] = useState("items"); // items | search | menu

  // nested tabs inside Items
  const [itemsView, setItemsView] = useState("all"); // all | folders | boxes | tags

  // Search tab quick filters
  const [searchFilter, setSearchFilter] = useState("all"); // all | recent | unfiled | photos | hasbox

  // Add item modal
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Item details sheet (tap an item)
  const [activeItem, setActiveItem] = useState(null);

  // Folder items sheet (tap a folder)
  const [activeFolderId, setActiveFolderId] = useState(null);

  // Data
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);

  // Selection for nested views
  const [selectedBox, setSelectedBox] = useState(null);
  const [selectedTag, setSelectedTag] = useState(null);

  // Search query (used ONLY in Search tab)
  const [q, setQ] = useState("");

  // Folder create
  const [newFolderName, setNewFolderName] = useState("");
  const [folderStatus, setFolderStatus] = useState("");

  // Item form (modal)
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [boxIdentifier, setBoxIdentifier] = useState("");
  const [notes, setNotes] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [folderId, setFolderId] = useState("");
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("");

  // Protect page
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.push("/");
      else setSession(data.session);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      if (!s) router.push("/");
      setSession(s);
    });

    return () => sub.subscription.unsubscribe();
  }, [router]);

  async function loadFolders() {
    const { data, error } = await supabase
      .from("folders")
      .select("id, name")
      .order("name", { ascending: true });

    if (!error) setFolders(data || []);
  }

  async function loadItems() {
    const { data, error } = await supabase
      .from("items")
      .select(
        "id, name, quantity, box_identifier, notes, tags, folder_id, created_at, item_photos(path)"
      )
      .order("created_at", { ascending: false });

    if (!error) setItems(data || []);
  }

  useEffect(() => {
    if (!session) return;
    loadFolders();
    loadItems();
  }, [session]);

  // switching tabs resets deep selection states
  useEffect(() => {
    setSelectedBox(null);
    setSelectedTag(null);

    // keep search scoped to Search tab
    if (topTab !== "search") {
      setSearchFilter("all");
      setQ("");
    }

    // close sheets when switching main tabs
    setActiveItem(null);
    setActiveFolderId(null);
  }, [topTab]);

  // switching nested Items tabs resets selection
  useEffect(() => {
    setSelectedBox(null);
    setSelectedTag(null);

    // when leaving folders view, close any folder sheet
    if (itemsView !== "folders") setActiveFolderId(null);
  }, [itemsView]);

  function parseTags(text) {
    return text
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 25);
  }

  async function getSignedUrl(path) {
    const { data, error } = await supabase.storage
      .from("item-photos")
      .createSignedUrl(path, 60 * 60);
    if (error) return "";
    return data?.signedUrl || "";
  }

  // -------- CRUD ----------
  async function createFolder(e) {
    e.preventDefault();
    setFolderStatus("");

    const userId = session.user.id;
    const folderName = newFolderName.trim();
    if (!folderName) return;

    const { error } = await supabase
      .from("folders")
      .insert([{ user_id: userId, name: folderName }]);

    if (error) return setFolderStatus(error.message);

    setNewFolderName("");
    setFolderStatus("Folder created!");
    await loadFolders();
    setTimeout(() => setFolderStatus(""), 1200);
  }

  function resetAddForm() {
    setName("");
    setQuantity(1);
    setBoxIdentifier("");
    setNotes("");
    setTagsText("");
    setFolderId("");
    setFiles([]);
  }

  async function addItem(e) {
    e.preventDefault();
    setStatus("Saving...");

    const userId = session.user.id;
    const tags = parseTags(tagsText);

    const { data: created, error: itemErr } = await supabase
      .from("items")
      .insert([
        {
          user_id: userId,
          name,
          quantity: Math.max(1, Number(quantity) || 1),
          box_identifier: boxIdentifier || null,
          notes: notes || null,
          tags,
          folder_id: folderId || null,
        },
      ])
      .select()
      .single();

    if (itemErr) return setStatus(itemErr.message);

    for (const file of files) {
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
      const path = `${userId}/${created.id}/${fileName}`;

      const { error: upErr } = await supabase.storage
        .from("item-photos")
        .upload(path, file, { upsert: false });

      if (upErr) return setStatus(upErr.message);

      const { error: photoErr } = await supabase
        .from("item_photos")
        .insert([{ item_id: created.id, user_id: userId, path }]);

      if (photoErr) return setStatus(photoErr.message);
    }

    setStatus("Saved!");
    await loadItems();
    setTimeout(() => setStatus(""), 900);

    resetAddForm();
    setIsAddOpen(false);
  }

  async function moveItem(itemId, newFolderId) {
    const folder_id = newFolderId === "none" ? null : newFolderId;
    const { error } = await supabase.from("items").update({ folder_id }).eq("id", itemId);

    if (!error) {
      await loadItems();
      setActiveItem((prev) => (prev && prev.id === itemId ? { ...prev, folder_id } : prev));
    }
  }

  async function deleteItem(itemId) {
    const ok = confirm("Delete this item? This cannot be undone.");
    if (!ok) return;

    const { error } = await supabase.from("items").delete().eq("id", itemId);
    if (!error) {
      setActiveItem(null);
      await loadItems();
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  // -------- Derived lists ----------
  const folderNameById = useMemo(() => {
    const map = new Map();
    folders.forEach((f) => map.set(f.id, f.name));
    return map;
  }, [folders]);

  const boxes = useMemo(() => {
    const set = new Set();
    items.forEach((it) => it.box_identifier && set.add(it.box_identifier));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const tags = useMemo(() => {
    const set = new Set();
    items.forEach((it) => (it.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Count items per folder
  const folderCounts = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (!it.folder_id) continue;
      map.set(it.folder_id, (map.get(it.folder_id) || 0) + 1);
    }
    return map;
  }, [items]);

  // Up to 3 thumbnail paths per folder
  const folderThumbPaths = useMemo(() => {
    const map = new Map();
    for (const it of items) {
      if (!it.folder_id) continue;
      const path = (it.item_photos || [])[0]?.path;
      if (!path) continue;

      const arr = map.get(it.folder_id) || [];
      if (arr.length < 3) {
        arr.push(path);
        map.set(it.folder_id, arr);
      }
    }
    return map;
  }, [items]);

  const activeFolderItems = useMemo(() => {
    if (!activeFolderId) return [];
    return items.filter((it) => it.folder_id === activeFolderId);
  }, [items, activeFolderId]);

  const visibleItems = useMemo(() => {
    let list = items;

    // Search tab quick filters
    if (topTab === "search") {
      const now = Date.now();
      const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

      if (searchFilter === "recent") {
        list = list.filter((it) => {
          const t = new Date(it.created_at).getTime();
          return Number.isFinite(t) && now - t <= sevenDaysMs;
        });
      } else if (searchFilter === "unfiled") {
        list = list.filter((it) => !it.folder_id);
      } else if (searchFilter === "photos") {
        list = list.filter((it) => (it.item_photos || []).length > 0);
      } else if (searchFilter === "hasbox") {
        list = list.filter((it) => !!it.box_identifier);
      }

      // Search text applies ONLY in Search tab
      const s = q.trim().toLowerCase();
      if (s) {
        list = list.filter((it) => {
          const hay = `${it.name} ${it.box_identifier || ""} ${it.notes || ""} ${(it.tags || []).join(
            " "
          )}`.toLowerCase();
          return hay.includes(s);
        });
      }
    }

    // Items tab view filters
    if (topTab === "items") {
      if (itemsView === "boxes" && selectedBox) {
        list = list.filter((it) => it.box_identifier === selectedBox);
      }
      if (itemsView === "tags" && selectedTag) {
        list = list.filter((it) => (it.tags || []).includes(selectedTag));
      }
      // NOTE: folders view no longer shows items here
    }

    return list;
  }, [items, topTab, itemsView, selectedBox, selectedTag, q, searchFilter]);

  const showFab = topTab !== "menu";

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: THEME.bg,
        color: THEME.text,
        fontFamily: "system-ui",
      }}
    >
      {/* Page container */}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "16px 14px 110px" }}>
        {/* Header */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "grid", gap: 2 }}>
            <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.3px" }}>Cozy Stash</h1>
            <div style={{ fontSize: 12, color: THEME.muted }}>Home inventory, but calm.</div>
          </div>

          <button onClick={signOut} style={styles.primaryBtn}>
            Sign Out
          </button>
        </header>

        {/* MENU TAB */}
        {topTab === "menu" && (
          <section style={styles.surfaceCard}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Menu</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={loadItems} style={styles.secondaryBtn}>
                Refresh items
              </button>
              <button onClick={loadFolders} style={styles.secondaryBtn}>
                Refresh folders
              </button>
              <button onClick={() => setIsAddOpen(true)} style={styles.primaryBtn}>
                + Add item
              </button>
            </div>
            <p style={{ marginTop: 12, fontSize: 13, color: THEME.muted }}>
              Add later: export, backup, settings, theme toggle, etc.
            </p>
          </section>
        )}

        {/* SEARCH TAB */}
        {topTab === "search" && (
          <section style={{ marginTop: 16 }}>
            <div style={styles.surfaceCard}>
              <h2 style={{ marginTop: 0, marginBottom: 10 }}>Search</h2>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <Pill active={searchFilter === "all"} onClick={() => setSearchFilter("all")}>
                  All
                </Pill>
                <Pill active={searchFilter === "recent"} onClick={() => setSearchFilter("recent")}>
                  Recently added
                </Pill>
                <Pill active={searchFilter === "unfiled"} onClick={() => setSearchFilter("unfiled")}>
                  Unfiled
                </Pill>
                <Pill active={searchFilter === "photos"} onClick={() => setSearchFilter("photos")}>
                  Has photos
                </Pill>
                <Pill active={searchFilter === "hasbox"} onClick={() => setSearchFilter("hasbox")}>
                  Has box
                </Pill>
                <button
                  onClick={() => {
                    setSearchFilter("all");
                    setQ("");
                  }}
                  style={styles.linkBtn}
                >
                  Clear
                </button>
              </div>

              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search name, tags, box, notes…"
                style={styles.input}
              />
              <p style={{ marginTop: 8, fontSize: 13, color: THEME.muted }}>
                Tip: try “winter”, “BX-012”, or “kitchen”.
              </p>
            </div>

            <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
              {visibleItems.map((it) => (
                <ItemRow key={it.id} item={it} getSignedUrl={getSignedUrl} onOpen={() => setActiveItem(it)} />
              ))}
              {!visibleItems.length && <p style={{ color: THEME.muted, margin: 0 }}>No results.</p>}
            </div>
          </section>
        )}

        {/* ITEMS TAB */}
        {topTab === "items" && (
          <>
            {/* Nested tabs row (NO search box on Items page) */}
            <div style={{ marginTop: 14, display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
              <SubTab active={itemsView === "all"} onClick={() => setItemsView("all")}>
                All
              </SubTab>
              <SubTab active={itemsView === "folders"} onClick={() => setItemsView("folders")}>
                Folders
              </SubTab>
              <SubTab active={itemsView === "boxes"} onClick={() => setItemsView("boxes")}>
                Boxes
              </SubTab>
              <SubTab active={itemsView === "tags"} onClick={() => setItemsView("tags")}>
                Tags
              </SubTab>
              <button onClick={loadItems} style={{ ...styles.secondaryBtn, padding: "10px 12px" }}>
                Refresh
              </button>
            </div>

            {/* Main content area */}
            <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
              {/* FOLDERS VIEW: only folders list (no items) */}
              {itemsView === "folders" && (
                <section>
                  {/* Create folder */}
                  <div style={styles.surfaceCard}>
                    <h3 style={{ marginTop: 0, marginBottom: 10 }}>Folders</h3>

                    <form onSubmit={createFolder} style={{ display: "grid", gap: 8 }}>
                      <input
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        placeholder="New folder name"
                        style={styles.input}
                      />
                      <button style={styles.secondaryBtn}>Create folder</button>
                      {folderStatus && <div style={{ fontSize: 13, color: THEME.muted }}>{folderStatus}</div>}
                    </form>
                  </div>

                  {/* Folder cards */}
                  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                    {folders.map((f) => (
                      <FolderCard
                        key={f.id}
                        folder={f}
                        count={folderCounts.get(f.id) || 0}
                        thumbPaths={folderThumbPaths.get(f.id) || []}
                        getSignedUrl={getSignedUrl}
                        onOpen={() => setActiveFolderId(f.id)}
                      />
                    ))}

                    {!folders.length && <p style={{ color: THEME.muted, margin: 0 }}>No folders yet.</p>}
                  </div>
                </section>
              )}

              {/* NON-FOLDERS VIEWS: items list */}
              {itemsView !== "folders" && (
                <section>
                  {/* Boxes selector */}
                  {itemsView === "boxes" && !selectedBox && (
                    <div style={styles.surfaceCard}>
                      <h2 style={{ marginTop: 0, marginBottom: 10 }}>Boxes</h2>
                      {boxes.length === 0 ? (
                        <p style={{ color: THEME.muted, margin: 0 }}>No box identifiers yet.</p>
                      ) : (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {boxes.map((b) => (
                            <Pill key={b} active={false} onClick={() => setSelectedBox(b)}>
                              {b}
                            </Pill>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tags selector */}
                  {itemsView === "tags" && !selectedTag && (
                    <div style={styles.surfaceCard}>
                      <h2 style={{ marginTop: 0, marginBottom: 10 }}>Tags</h2>
                      {tags.length === 0 ? (
                        <p style={{ color: THEME.muted, margin: 0 }}>No tags yet.</p>
                      ) : (
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {tags.map((t) => (
                            <Pill key={t} active={false} onClick={() => setSelectedTag(t)}>
                              {t}
                            </Pill>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Back header for boxes/tags selected */}
                  {(selectedBox || selectedTag) && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 10,
                      }}
                    >
                      <button
                        onClick={() => {
                          setSelectedBox(null);
                          setSelectedTag(null);
                        }}
                        style={styles.secondaryBtn}
                      >
                        ← Back
                      </button>
                      <div style={{ fontWeight: 900 }}>
                        {selectedBox ? `Box: ${selectedBox}` : ""}
                        {selectedTag ? `Tag: ${selectedTag}` : ""}
                      </div>
                      <div />
                    </div>
                  )}

                  {/* Items list (compact rows) */}
                  <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                    {visibleItems.map((it) => (
                      <ItemRow key={it.id} item={it} getSignedUrl={getSignedUrl} onOpen={() => setActiveItem(it)} />
                    ))}
                    {!visibleItems.length && <p style={{ color: THEME.muted, margin: 0 }}>No items found.</p>}
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </div>

      {/* Floating Action Button (FAB) */}
      {showFab && (
        <button onClick={() => setIsAddOpen(true)} aria-label="Add item" style={styles.fab}>
          +
        </button>
      )}

      {/* Bottom Navigation */}
      <BottomNav
        active={topTab}
        onChange={(tab) => {
          setTopTab(tab);
        }}
      />

      {/* ADD ITEM (bottom sheet) */}
      {isAddOpen && (
        <BottomSheetModal
          title="Add item"
          onClose={() => {
            setIsAddOpen(false);
            setStatus("");
          }}
        >
          <form onSubmit={addItem} style={{ display: "grid", gap: 10 }}>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Item name *"
              style={styles.input}
            />

            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "140px 1fr" }}>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="Qty"
                style={styles.input}
              />
              <input
                value={boxIdentifier}
                onChange={(e) => setBoxIdentifier(e.target.value)}
                placeholder="Box identifier (e.g., BX-012)"
                style={styles.input}
              />
            </div>

            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes"
              style={{ ...styles.input, minHeight: 90, resize: "vertical" }}
            />

            <input
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="Tags (comma separated: kitchen, winter, tools)"
              style={styles.input}
            />

            <select value={folderId} onChange={(e) => setFolderId(e.target.value)} style={styles.input}>
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>

            <input
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              style={{ fontSize: 13 }}
            />

            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
              <button
                type="button"
                onClick={() => {
                  setIsAddOpen(false);
                  setStatus("");
                }}
                style={styles.secondaryBtn}
              >
                Cancel
              </button>
              <button style={styles.primaryBtn}>Save</button>
            </div>

            {status && <p style={{ margin: 0, color: THEME.muted }}>{status}</p>}
          </form>
        </BottomSheetModal>
      )}

      {/* FOLDER ITEMS (bottom sheet) */}
      {activeFolderId && (
        <FolderItemsSheet
          folderName={folderNameById.get(activeFolderId) || "Folder"}
          items={activeFolderItems}
          getSignedUrl={getSignedUrl}
          onClose={() => setActiveFolderId(null)}
          onOpenItem={(it) => setActiveItem(it)}
        />
      )}

      {/* ITEM DETAILS (bottom sheet) */}
      {activeItem && (
        <ItemDetailsSheet
          item={activeItem}
          folders={folders}
          folderNameById={folderNameById}
          getSignedUrl={getSignedUrl}
          onClose={() => setActiveItem(null)}
          onDelete={deleteItem}
          onMove={moveItem}
        />
      )}
    </main>
  );
}

/* =========================
   Components
========================= */

function BottomNav({ active, onChange }) {
  return (
    <nav
      style={{
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(10px)",
        borderTop: `1px solid ${THEME.border}`,
        padding: "10px 10px calc(10px + env(safe-area-inset-bottom))",
        zIndex: 40,
      }}
    >
      <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", justifyContent: "space-around", gap: 10 }}>
        <NavBtn active={active === "items"} onClick={() => onChange("items")} icon="🏠" label="Items" />
        <NavBtn active={active === "search"} onClick={() => onChange("search")} icon="🔍" label="Search" />
        <NavBtn active={active === "menu"} onClick={() => onChange("menu")} icon="☰" label="Menu" />
      </div>
    </nav>
  );
}

function NavBtn({ active, onClick, icon, label }) {
  return (
    <button
      onClick={onClick}
      style={{
        flex: 1,
        display: "grid",
        placeItems: "center",
        gap: 4,
        padding: "8px 8px",
        borderRadius: 12,
        border: `1px solid ${active ? THEME.accentSoft : "transparent"}`,
        background: active ? THEME.accentSoft : "transparent",
        color: active ? THEME.text : THEME.muted,
        fontWeight: 900,
        cursor: "pointer",
      }}
    >
      <div style={{ fontSize: 18, lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: 12 }}>{label}</div>
    </button>
  );
}

function SubTab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 10, // less bubbly
        border: `1px solid ${active ? THEME.accent : THEME.border}`,
        fontWeight: 950,
        background: active ? THEME.accent : THEME.card,
        color: active ? "white" : THEME.text,
        boxShadow: active ? THEME.shadow : "none",
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function Pill({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 10, // less bubbly
        border: `1px solid ${active ? THEME.accent : THEME.border}`,
        fontWeight: 900,
        background: active ? THEME.accentSoft : THEME.card,
        color: THEME.text,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/* Compact list row: thumbnail right + name + first tag (plain text) */
function ItemRow({ item, getSignedUrl, onOpen }) {
  const [thumb, setThumb] = useState("");

  useEffect(() => {
    let alive = true;
    async function run() {
      const first = (item.item_photos || [])[0]?.path;
      if (!first) return;
      const url = await getSignedUrl(first);
      if (alive) setThumb(url || "");
    }
    run();
    return () => {
      alive = false;
    };
  }, [item, getSignedUrl]);

  const tag = (item.tags || [])[0] || "";

  return (
    <button onClick={onOpen} style={compact.cardBtn}>
      <div style={{ minWidth: 0 }}>
        <div style={compact.title}>{item.name}</div>
        {tag ? <div style={compact.tagText}>{tag}</div> : <div style={compact.tagPlaceholder} />}
      </div>

      <div style={compact.thumbWrap}>
        {thumb ? <img src={thumb} alt="" style={compact.thumbImg} /> : <div style={compact.thumbEmpty}>No Photo</div>}
      </div>
    </button>
  );
}

// Folder card: icon stack (up to 3 thumbnails) + folder name + item count
function FolderCard({ folder, count, thumbPaths, getSignedUrl, onOpen }) {
  const [thumbs, setThumbs] = useState([]);

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!thumbPaths || thumbPaths.length === 0) {
        if (alive) setThumbs([]);
        return;
      }
      const signed = await Promise.all(thumbPaths.map(getSignedUrl));
      if (alive) setThumbs(signed.filter(Boolean));
    }

    run();
    return () => {
      alive = false;
    };
  }, [thumbPaths, getSignedUrl]);

  return (
    <button onClick={onOpen} style={folderUI.card}>
      <div style={folderUI.left}>
        {thumbs.length ? (
          <div style={folderUI.stack}>
            {thumbs.slice(0, 3).map((u, idx) => (
              <img
                key={u}
                src={u}
                alt=""
                style={{
                  ...folderUI.stackImg,
                  transform: `translateX(${idx * 10}px)`,
                  zIndex: 10 - idx,
                }}
              />
            ))}
          </div>
        ) : (
          <div style={folderUI.emptyIcon}>📁</div>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        <div style={folderUI.title}>{folder.name}</div>
        <div style={folderUI.sub}>
          {count} item{count === 1 ? "" : "s"}
        </div>
      </div>

      <div style={folderUI.chev}>›</div>
    </button>
  );
}

function FolderItemsSheet({ folderName, items, getSignedUrl, onClose, onOpenItem }) {
  return (
    <BottomSheetModal title={folderName} onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        {items.map((it) => (
          <ItemRow key={it.id} item={it} getSignedUrl={getSignedUrl} onOpen={() => onOpenItem(it)} />
        ))}
        {!items.length && <p style={{ color: THEME.muted, margin: 0 }}>No items in this folder yet.</p>}
      </div>
    </BottomSheetModal>
  );
}

/* Bottom-sheet modal (shared) */
function BottomSheetModal({ title, onClose, children }) {
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.30)",
        backdropFilter: "blur(6px)",
        zIndex: 80,
        display: "grid",
        alignItems: "end",
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 760,
          margin: "0 auto",
          background: THEME.card,
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          border: `1px solid ${THEME.border}`,
          borderBottom: "none",
          boxShadow: THEME.shadowStrong,
          padding: 14,
          maxHeight: "82dvh",
          overflow: "auto",
        }}
      >
        <div style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              width: 54,
              height: 5,
              borderRadius: 999,
              background: THEME.border,
              margin: "2px auto 0",
            }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
            <button onClick={onClose} style={styles.secondaryBtn}>
              Close
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>{children}</div>
        <div style={{ height: "calc(10px + env(safe-area-inset-bottom))" }} />
      </div>
    </div>
  );
}

/* Item details sheet (all details on click) */
function ItemDetailsSheet({ item, folders, folderNameById, getSignedUrl, onClose, onDelete, onMove }) {
  const [urls, setUrls] = useState([]);

  useEffect(() => {
    let alive = true;
    async function run() {
      const paths = (item.item_photos || []).map((p) => p.path);
      const signed = await Promise.all(paths.map(getSignedUrl));
      if (alive) setUrls(signed.filter(Boolean));
    }
    run();
    return () => {
      alive = false;
    };
  }, [item, getSignedUrl]);

  const folderName = item.folder_id ? folderNameById.get(item.folder_id) || "Folder" : "Unfiled";

  return (
    <BottomSheetModal title={item.name} onClose={onClose}>
      <div style={{ display: "grid", gap: 12 }}>
        {urls.length > 0 ? (
          <img
            src={urls[0]}
            alt=""
            style={{
              width: "100%",
              height: 260,
              objectFit: "cover",
              borderRadius: 12,
              border: `1px solid ${THEME.border}`,
            }}
          />
        ) : (
          <div
            style={{
              width: "100%",
              height: 180,
              borderRadius: 12,
              border: `1px solid ${THEME.border}`,
              background: "#FAF7F2",
              display: "grid",
              placeItems: "center",
              color: THEME.muted,
              fontWeight: 900,
            }}
          >
            No photos yet
          </div>
        )}

        {(item.tags || []).length > 0 && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {item.tags.map((t) => (
              <span
                key={t}
                style={{
                  padding: "6px 10px",
                  borderRadius: 10,
                  border: `1px solid ${THEME.border}`,
                  background: "#FAF7F2",
                  fontSize: 12,
                  fontWeight: 900,
                  color: THEME.text,
                }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gap: 8, color: THEME.text }}>
          <div>
            <b>Folder:</b> {folderName}
          </div>
          <div>
            <b>Quantity:</b> {item.quantity || 1}
          </div>
          {item.box_identifier ? (
            <div>
              <b>Box:</b> {item.box_identifier}
            </div>
          ) : null}
          {item.notes ? (
            <div>
              <b>Notes:</b> {item.notes}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap" }}>
          <select
            value={item.folder_id || "none"}
            onChange={(e) => onMove(item.id, e.target.value)}
            style={{
              flex: 1,
              minWidth: 220,
              padding: 12,
              borderRadius: 12,
              border: `1px solid ${THEME.border}`,
              background: THEME.card,
              color: THEME.text,
              fontWeight: 900,
            }}
          >
            <option value="none">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>

          <button
            onClick={() => onDelete(item.id)}
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #8B2E2E",
              background: "#8B2E2E",
              color: "white",
              fontWeight: 950,
              cursor: "pointer",
            }}
          >
            Delete
          </button>
        </div>

        {urls.length > 1 && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {urls.slice(1, 5).map((u) => (
              <img
                key={u}
                src={u}
                alt=""
                style={{
                  width: "calc(50% - 5px)",
                  height: 130,
                  objectFit: "cover",
                  borderRadius: 12,
                  border: `1px solid ${THEME.border}`,
                }}
              />
            ))}
          </div>
        )}
      </div>
    </BottomSheetModal>
  );
}

/* =========================
   Styles
========================= */

const compact = {
  cardBtn: {
    width: "100%",
    textAlign: "left",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: THEME.card,
    boxShadow: THEME.shadow,
    cursor: "pointer",
  },
  title: {
    fontSize: 16,
    fontWeight: 950,
    color: THEME.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    letterSpacing: "-0.2px",
  },
  // plain text tag (not a bubble)
  tagText: {
    marginTop: 8,
    fontSize: 13,
    color: THEME.muted,
    fontWeight: 700,
  },
  tagPlaceholder: {
    marginTop: 8,
    height: 22,
  },
  thumbWrap: {
    flex: "0 0 auto",
    width: 70,
    height: 70,
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    overflow: "hidden",
    background: "#FAF7F2",
    display: "grid",
    placeItems: "center",
  },
  thumbImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  thumbEmpty: {
    fontSize: 11,
    color: THEME.muted,
    padding: 6,
    textAlign: "center",
    fontWeight: 800,
  },
};

const folderUI = {
  card: {
    width: "100%",
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: THEME.card,
    boxShadow: THEME.shadow,
    cursor: "pointer",
  },
  left: {
    width: 56,
    height: 56,
    display: "grid",
    placeItems: "center",
    flex: "0 0 auto",
  },
  stack: {
    position: "relative",
    width: 56,
    height: 56,
  },
  stackImg: {
    position: "absolute",
    top: 6,
    left: 0,
    width: 44,
    height: 44,
    borderRadius: 10,
    objectFit: "cover",
    border: `1px solid ${THEME.border}`,
    background: "#FAF7F2",
  },
  emptyIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    border: `1px solid ${THEME.border}`,
    background: "#FAF7F2",
    display: "grid",
    placeItems: "center",
    fontSize: 18,
  },
  title: {
    fontSize: 16,
    fontWeight: 950,
    color: THEME.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  sub: {
    marginTop: 6,
    fontSize: 13,
    color: THEME.muted,
    fontWeight: 700,
  },
  chev: {
    marginLeft: "auto",
    fontSize: 22,
    color: THEME.muted,
    fontWeight: 900,
    lineHeight: 1,
  },
};

const styles = {
  surfaceCard: {
    marginTop: 16,
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    padding: 14,
    background: THEME.card,
    boxShadow: THEME.shadow,
  },
  input: {
    padding: 12,
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: THEME.card,
    color: THEME.text,
    outline: "none",
    boxShadow: "inset 0 1px 0 rgba(0,0,0,0.02)",
  },
  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: `1px solid ${THEME.accent}`,
    background: THEME.accent,
    color: "white",
    fontWeight: 950,
    cursor: "pointer",
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: "#FAF7F2",
    color: THEME.text,
    fontWeight: 950,
    cursor: "pointer",
  },
  linkBtn: {
    padding: "8px 10px",
    borderRadius: 12,
    border: "1px solid transparent",
    background: "transparent",
    color: THEME.text,
    fontWeight: 950,
    textDecoration: "underline",
    cursor: "pointer",
  },
  fab: {
    position: "fixed",
    right: 16,
    bottom: 84,
    width: 62,
    height: 62,
    borderRadius: "50%",
    border: `1px solid ${THEME.accent}`,
    background: THEME.accent,
    color: "white",
    fontSize: 30,
    fontWeight: 950,
    boxShadow: THEME.shadowStrong,
    zIndex: 55,
    cursor: "pointer",
  },
};
