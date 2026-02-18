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

  // TOP TABS (now used as bottom nav)
  const [topTab, setTopTab] = useState("items"); // items | search | menu

  // NESTED TABS inside Items
  const [itemsView, setItemsView] = useState("all"); // all | folders | boxes | tags

  // SEARCH TAB quick filters
  const [searchFilter, setSearchFilter] = useState("all"); // all | recent | unfiled | photos | hasbox

  // Modal
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Data
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);

  // Filters / selection
  const [q, setQ] = useState("");
  const [selectedFolderId, setSelectedFolderId] = useState("all");
  const [selectedBox, setSelectedBox] = useState(null);
  const [selectedTag, setSelectedTag] = useState(null);

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
    if (topTab !== "search") {
      setSearchFilter("all");
    }
  }, [topTab]);

  // switching nested Items tabs resets deep selection
  useEffect(() => {
    setSelectedBox(null);
    setSelectedTag(null);
    setSelectedFolderId("all");
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
    if (!error) loadItems();
  }

  async function updateQuantity(itemId, newQty) {
    const qty = Math.max(1, Number(newQty) || 1);
    const { error } = await supabase.from("items").update({ quantity: qty }).eq("id", itemId);
    if (!error) loadItems();
  }

  async function deleteItem(itemId) {
    const ok = confirm("Delete this item? This cannot be undone.");
    if (!ok) return;

    const { error } = await supabase.from("items").delete().eq("id", itemId);
    if (!error) loadItems();
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
    }

    // Items tab nested view filters
    if (topTab === "items") {
      if (itemsView === "folders" && selectedFolderId !== "all") {
        list = list.filter((it) => it.folder_id === selectedFolderId);
      }
      if (itemsView === "boxes" && selectedBox) {
        list = list.filter((it) => it.box_identifier === selectedBox);
      }
      if (itemsView === "tags" && selectedTag) {
        list = list.filter((it) => (it.tags || []).includes(selectedTag));
      }
    }

    // Search text (Items + Search tab)
    const s = q.trim().toLowerCase();
    if (!s) return list;

    return list.filter((it) => {
      const hay = `${it.name} ${it.box_identifier || ""} ${it.notes || ""} ${(it.tags || []).join(
        " "
      )}`.toLowerCase();
      return hay.includes(s);
    });
  }, [
    items,
    topTab,
    itemsView,
    selectedFolderId,
    selectedBox,
    selectedTag,
    q,
    searchFilter,
  ]);

  const showFab = topTab !== "menu"; // keep it clean on Menu

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: THEME.bg,
        color: THEME.text,
        fontFamily: "system-ui",
      }}
    >
      {/* Page container (mobile-friendly width) */}
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "16px 14px 110px" }}>
        {/* Header */}
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <div style={{ display: "grid", gap: 2 }}>
            <h1 style={{ margin: 0, fontSize: 22, letterSpacing: "-0.3px" }}>Cozy Stash</h1>
            <div style={{ fontSize: 12, color: THEME.muted }}>
              Home inventory, but calm.
            </div>
          </div>

          {/* Keep sign out tucked here (still accessible) */}
          <button onClick={signOut} style={styles.primaryBtn}>
            Sign Out
          </button>
        </header>

        {/* MENU TAB */}
        {topTab === "menu" && (
          <section style={styles.surfaceCard}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Menu</h2>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button onClick={loadItems} style={styles.secondaryBtn}>Refresh items</button>
              <button onClick={loadFolders} style={styles.secondaryBtn}>Refresh folders</button>
              <button onClick={() => setIsAddOpen(true)} style={styles.primaryBtn}>+ Add item</button>
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

              {/* Quick filters */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                <Pill active={searchFilter === "all"} onClick={() => setSearchFilter("all")}>All</Pill>
                <Pill active={searchFilter === "recent"} onClick={() => setSearchFilter("recent")}>Recently added</Pill>
                <Pill active={searchFilter === "unfiled"} onClick={() => setSearchFilter("unfiled")}>Unfiled</Pill>
                <Pill active={searchFilter === "photos"} onClick={() => setSearchFilter("photos")}>Has photos</Pill>
                <Pill active={searchFilter === "hasbox"} onClick={() => setSearchFilter("hasbox")}>Has box</Pill>
                <button onClick={() => { setSearchFilter("all"); setQ(""); }} style={styles.linkBtn}>
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
                <ItemCard
                  key={it.id}
                  item={it}
                  folders={folders}
                  folderNameById={folderNameById}
                  getSignedUrl={getSignedUrl}
                  onMove={moveItem}
                  onQty={updateQuantity}
                  onDelete={deleteItem}
                />
              ))}
              {!visibleItems.length && <p style={{ color: THEME.muted, margin: 0 }}>No results.</p>}
            </div>
          </section>
        )}

        {/* ITEMS TAB */}
        {topTab === "items" && (
          <>
            {/* Search bar at top of Items */}
            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search your stash…"
                style={styles.input}
              />

              {/* Nested tabs (All / Folders / Boxes / Tags) */}
              <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 2 }}>
                <SubTab active={itemsView === "all"} onClick={() => setItemsView("all")}>All</SubTab>
                <SubTab active={itemsView === "folders"} onClick={() => setItemsView("folders")}>Folders</SubTab>
                <SubTab active={itemsView === "boxes"} onClick={() => setItemsView("boxes")}>Boxes</SubTab>
                <SubTab active={itemsView === "tags"} onClick={() => setItemsView("tags")}>Tags</SubTab>
                <button onClick={loadItems} style={{ ...styles.secondaryBtn, padding: "10px 12px" }}>
                  Refresh
                </button>
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: itemsView === "folders" ? "260px 1fr" : "1fr",
                gap: 14,
                marginTop: 14,
              }}
            >
              {/* Folders sidebar only in folders view */}
              {itemsView === "folders" && (
                <aside style={styles.surfaceCard}>
                  <h3 style={{ marginTop: 0, marginBottom: 10 }}>Folders</h3>

                  <button
                    onClick={() => setSelectedFolderId("all")}
                    style={{
                      ...styles.sidebarBtn,
                      fontWeight: selectedFolderId === "all" ? 900 : 700,
                      background: selectedFolderId === "all" ? THEME.accentSoft : THEME.card,
                      borderColor: selectedFolderId === "all" ? THEME.accent : THEME.border,
                      color: THEME.text,
                    }}
                  >
                    All folders
                  </button>

                  {folders.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSelectedFolderId(f.id)}
                      style={{
                        ...styles.sidebarBtn,
                        fontWeight: selectedFolderId === f.id ? 900 : 700,
                        background: selectedFolderId === f.id ? THEME.accentSoft : THEME.card,
                        borderColor: selectedFolderId === f.id ? THEME.accent : THEME.border,
                        color: THEME.text,
                      }}
                    >
                      {f.name}
                    </button>
                  ))}

                  <hr style={{ margin: "12px 0", border: "none", borderTop: `1px solid ${THEME.border}` }} />

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
                </aside>
              )}

              {/* Main items panel */}
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

                {(selectedBox || selectedTag) && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                    <button
                      onClick={() => {
                        setSelectedBox(null);
                        setSelectedTag(null);
                        setQ("");
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

                {/* Items list */}
                <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                  {visibleItems.map((it) => (
                    <ItemCard
                      key={it.id}
                      item={it}
                      folders={folders}
                      folderNameById={folderNameById}
                      getSignedUrl={getSignedUrl}
                      onMove={moveItem}
                      onQty={updateQuantity}
                      onDelete={deleteItem}
                    />
                  ))}
                  {!visibleItems.length && <p style={{ color: THEME.muted, margin: 0 }}>No items found.</p>}
                </div>
              </section>
            </div>
          </>
        )}
      </div>

      {/* Floating Action Button (FAB) */}
      {showFab && (
        <button
          onClick={() => setIsAddOpen(true)}
          aria-label="Add item"
          style={styles.fab}
        >
          +
        </button>
      )}

      {/* Bottom Navigation */}
      <BottomNav
        active={topTab}
        onChange={(tab) => {
          setTopTab(tab);
          if (tab === "search") {
            // keep search state, but reset quick filter to “all” if you want:
            // setSearchFilter("all");
          }
        }}
      />

      {/* ADD ITEM MODAL */}
      {isAddOpen && (
        <Modal
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
        </Modal>
      )}
    </main>
  );
}

/* =========================
   UI Components
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
        borderRadius: 14,
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
        padding: "10px 14px",
        borderRadius: 999,
        border: `1px solid ${active ? THEME.accent : THEME.border}`,
        fontWeight: 900,
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
        borderRadius: 999,
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

function Modal({ title, onClose, children }) {
  return (
    <div
      onMouseDown={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.30)",
        backdropFilter: "blur(6px)",
        display: "grid",
        placeItems: "center",
        padding: 14,
        zIndex: 60,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          background: THEME.card,
          borderRadius: 18,
          border: `1px solid ${THEME.border}`,
          padding: 14,
          boxShadow: THEME.shadowStrong,
          color: THEME.text,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={styles.secondaryBtn}>
            Close
          </button>
        </div>

        <div style={{ marginTop: 12 }}>{children}</div>
      </div>
    </div>
  );
}

function ItemCard({ item, folders, folderNameById, getSignedUrl, onMove, onQty, onDelete }) {
  const [urls, setUrls] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const folderName = item.folder_id ? (folderNameById.get(item.folder_id) || "Folder") : "Unfiled";
  const hasTags = (item.tags || []).length > 0;

  return (
    <div style={ui.card}>
      {/* Header */}
      <div style={ui.rowBetween}>
        <div style={{ minWidth: 0 }}>
          <div style={ui.title}>{item.name}</div>
          <div style={ui.metaRow}>
            <PillSmall tone="soft">{folderName}</PillSmall>
            {item.box_identifier ? <PillSmall tone="soft">Box: {item.box_identifier}</PillSmall> : null}
            {hasTags ? (
              <PillSmall tone="accent">
                {item.tags.slice(0, 2).join(" • ")}
                {item.tags.length > 2 ? " +" : ""}
              </PillSmall>
            ) : null}
          </div>
        </div>

        {/* Kebab menu */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setMenuOpen((v) => !v)} style={ui.kebabBtn} aria-label="Item menu">
            ⋯
          </button>

          {menuOpen && (
            <div style={ui.menu}>
              <button
                style={{ ...ui.menuItem, color: "#8B2E2E" }}
                onClick={() => {
                  setMenuOpen(false);
                  onDelete(item.id);
                }}
              >
                Delete
              </button>
              <div style={ui.menuDivider} />
              <div style={{ padding: 10 }}>
                <div style={{ fontSize: 12, color: THEME.muted, marginBottom: 6 }}>Move to folder</div>
                <select
                  value={item.folder_id || "none"}
                  onChange={(e) => {
                    onMove(item.id, e.target.value);
                    setMenuOpen(false);
                  }}
                  style={ui.select}
                >
                  <option value="none">No folder</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notes */}
      {item.notes ? <div style={ui.notes}>{item.notes}</div> : null}

      {/* Photos */}
      {urls.length > 0 && (
        <div style={ui.photoWrap}>
          {urls.slice(0, 4).map((u) => (
            <img
              key={u}
              src={u}
              alt=""
              style={{
                ...ui.photo,
                width: urls.length === 1 ? "100%" : "calc(50% - 6px)",
                height: urls.length === 1 ? 220 : 130,
              }}
            />
          ))}
        </div>
      )}

      {/* Footer controls */}
      <div style={ui.footer}>
        <div style={ui.qtyWrap}>
          <button
            onClick={() => onQty(item.id, (item.quantity || 1) - 1)}
            style={ui.qtyBtn}
            aria-label="Decrease quantity"
          >
            −
          </button>
          <div style={ui.qtyValue}>{item.quantity || 1}</div>
          <button
            onClick={() => onQty(item.id, (item.quantity || 1) + 1)}
            style={ui.qtyBtn}
            aria-label="Increase quantity"
          >
            +
          </button>
        </div>

        <div style={{ fontSize: 12, color: THEME.muted }}>Tap ⋯ for move/delete</div>
      </div>
    </div>
  );
}

function PillSmall({ children, tone = "soft" }) {
  const isAccent = tone === "accent";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid ${isAccent ? THEME.accent : THEME.border}`,
        background: isAccent ? THEME.accentSoft : "#FAF7F2",
        color: THEME.text,
        fontSize: 12,
        fontWeight: 900,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}

/* =========================
   Styles
========================= */

const ui = {
  card: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 18,
    padding: 14,
    background: THEME.card,
    color: THEME.text,
    boxShadow: THEME.shadow,
  },
  rowBetween: { display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" },
  title: {
    fontSize: 16,
    fontWeight: 950,
    color: THEME.text,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    letterSpacing: "-0.2px",
  },
  metaRow: { display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 },
  notes: { marginTop: 10, fontSize: 13, lineHeight: 1.35, color: THEME.muted },

  photoWrap: { display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 },
  photo: { borderRadius: 16, objectFit: "cover", border: `1px solid ${THEME.border}` },

  footer: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 10 },

  qtyWrap: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    border: `1px solid ${THEME.border}`,
    borderRadius: 999,
    padding: "6px 10px",
    background: "#FAF7F2",
  },
  qtyBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: THEME.card,
    color: THEME.text,
    fontSize: 18,
    fontWeight: 950,
    cursor: "pointer",
  },
  qtyValue: { minWidth: 24, textAlign: "center", fontWeight: 950, color: THEME.text },

  kebabBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    border: `1px solid ${THEME.border}`,
    background: THEME.card,
    color: THEME.text,
    fontSize: 22,
    fontWeight: 950,
    cursor: "pointer",
  },

  menu: {
    position: "absolute",
    right: 0,
    top: 44,
    width: 230,
    background: THEME.card,
    border: `1px solid ${THEME.border}`,
    borderRadius: 16,
    boxShadow: THEME.shadowStrong,
    overflow: "hidden",
    zIndex: 80,
  },
  menuItem: {
    width: "100%",
    textAlign: "left",
    padding: 12,
    background: "transparent",
    border: "none",
    fontWeight: 950,
    cursor: "pointer",
  },
  menuDivider: { height: 1, background: THEME.border },

  select: {
    width: "100%",
    padding: 10,
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: THEME.card,
    color: THEME.text,
    fontWeight: 900,
  },
};

const styles = {
  surfaceCard: {
    marginTop: 16,
    border: `1px solid ${THEME.border}`,
    borderRadius: 18,
    padding: 14,
    background: THEME.card,
    boxShadow: THEME.shadow,
  },
  input: {
    padding: 12,
    borderRadius: 14,
    border: `1px solid ${THEME.border}`,
    background: THEME.card,
    color: THEME.text,
    outline: "none",
    boxShadow: "inset 0 1px 0 rgba(0,0,0,0.02)",
  },
  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 14,
    border: `1px solid ${THEME.accent}`,
    background: THEME.accent,
    color: "white",
    fontWeight: 950,
    cursor: "pointer",
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 14,
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
  sidebarBtn: {
    width: "100%",
    textAlign: "left",
    padding: 10,
    marginBottom: 8,
    borderRadius: 14,
    border: `1px solid ${THEME.border}`,
    background: THEME.card,
    cursor: "pointer",
  },
  fab: {
    position: "fixed",
    right: 16,
    bottom: 84, // above bottom nav
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