"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function InventoryPage() {
  const router = useRouter();

  const [session, setSession] = useState(null);

  // TOP TABS
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

  // switching TOP tabs resets deep selection states
  useEffect(() => {
    setSelectedBox(null);
    setSelectedTag(null);
    if (topTab !== "search") {
      setSearchFilter("all");
    }
  }, [topTab]);

  // switching nested Items tabs resets deep selection + query
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

    // close modal + reset
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

    // Search text (used in Items and Search tab)
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

  return (
    <main style={{ maxWidth: 1100, margin: "20px auto", fontFamily: "system-ui", padding: 12 }}>
      {/* Header */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h1 style={{ margin: 0 }}>Home Inventory</h1>
        <button onClick={signOut} style={styles.primaryBtn}>Sign Out</button>
      </header>

      {/* TOP TABS */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        <TopTab active={topTab === "items"} onClick={() => setTopTab("items")}>Items</TopTab>
        <TopTab
          active={topTab === "search"}
          onClick={() => {
            setTopTab("search");
            setQ("");
            setSearchFilter("all");
          }}
        >
          Search
        </TopTab>
        <TopTab active={topTab === "menu"} onClick={() => setTopTab("menu")}>Menu</TopTab>
      </div>

      {/* MENU TAB */}
      {topTab === "menu" && (
        <section style={styles.card}>
          <h2 style={{ marginTop: 0 }}>Menu</h2>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={loadItems} style={styles.secondaryBtn}>Refresh items</button>
            <button onClick={loadFolders} style={styles.secondaryBtn}>Refresh folders</button>
            <button onClick={() => setIsAddOpen(true)} style={styles.primaryBtn}>+ Add item</button>
          </div>
          <p style={{ marginTop: 12, fontSize: 13, opacity: 0.85 }}>
            Add more later: export, backup, settings, etc.
          </p>
        </section>
      )}

      {/* SEARCH TAB */}
      {topTab === "search" && (
        <section style={{ marginTop: 16 }}>
          <div style={styles.card}>
            <h2 style={{ marginTop: 0 }}>Search</h2>

            {/* Quick filters */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <Pill active={searchFilter === "all"} onClick={() => setSearchFilter("all")}>All</Pill>
              <Pill active={searchFilter === "recent"} onClick={() => setSearchFilter("recent")}>Recently added</Pill>
              <Pill active={searchFilter === "unfiled"} onClick={() => setSearchFilter("unfiled")}>Unfiled</Pill>
              <Pill active={searchFilter === "photos"} onClick={() => setSearchFilter("photos")}>Has photos</Pill>
              <Pill active={searchFilter === "hasbox"} onClick={() => setSearchFilter("hasbox")}>Has box</Pill>
              <button
                onClick={() => { setSearchFilter("all"); setQ(""); }}
                style={styles.linkBtn}
              >
                Clear
              </button>
            </div>

            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, tags, box, notes…"
              style={{ padding: 10, width: "100%", borderRadius: 10, border: "1px solid #ddd" }}
            />
            <p style={{ marginTop: 8, fontSize: 13, opacity: 0.8 }}>
              Tip: try “winter”, “BX-012”, or “kitchen”.
            </p>
          </div>

          <div style={{ display: "grid", gap: 12 }}>
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
            {!visibleItems.length && <p>No results.</p>}
          </div>
        </section>
      )}

      {/* ITEMS TAB */}
      {topTab === "items" && (
        <>
          {/* Items header row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginTop: 16 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <SubTab active={itemsView === "all"} onClick={() => setItemsView("all")}>All</SubTab>
              <SubTab active={itemsView === "folders"} onClick={() => setItemsView("folders")}>Folders</SubTab>
              <SubTab active={itemsView === "boxes"} onClick={() => setItemsView("boxes")}>Boxes</SubTab>
              <SubTab active={itemsView === "tags"} onClick={() => setItemsView("tags")}>Tags</SubTab>
            </div>

            {/* Add item button instead of inline form */}
            <button onClick={() => setIsAddOpen(true)} style={styles.primaryBtn}>
              + Add item
            </button>
          </div>

          {/* Optional search bar on Items tab (still helpful) */}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search within Items…"
              style={{ padding: 10, flex: 1, borderRadius: 10, border: "1px solid #ddd" }}
            />
            <button onClick={loadItems} style={styles.secondaryBtn}>Refresh</button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: itemsView === "folders" ? "260px 1fr" : "1fr",
              gap: 16,
              marginTop: 16,
            }}
          >
            {/* Folders sidebar only in folders view */}
            {itemsView === "folders" && (
              <aside style={styles.card}>
                <h3 style={{ marginTop: 0 }}>Folders</h3>

                <button
                  onClick={() => setSelectedFolderId("all")}
                  style={{
                    ...styles.sidebarBtn,
                    fontWeight: selectedFolderId === "all" ? 800 : 500,
                    background: selectedFolderId === "all" ? "#111827" : "#f9fafb",
                    color: selectedFolderId === "all" ? "white" : "#111827",
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
                      fontWeight: selectedFolderId === f.id ? 800 : 500,
                      background: selectedFolderId === f.id ? "#111827" : "#f9fafb",
                      color: selectedFolderId === f.id ? "white" : "#111827",
                    }}
                  >
                    {f.name}
                  </button>
                ))}

                <hr style={{ margin: "12px 0" }} />

                <form onSubmit={createFolder} style={{ display: "grid", gap: 8 }}>
                  <input
                    value={newFolderName}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="New folder name"
                    style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
                  />
                  <button style={styles.secondaryBtn}>Create folder</button>
                  {folderStatus && <div style={{ fontSize: 13 }}>{folderStatus}</div>}
                </form>
              </aside>
            )}

            {/* Main items panel */}
            <section>
              {/* Boxes selector */}
              {itemsView === "boxes" && !selectedBox && (
                <div style={styles.card}>
                  <h2 style={{ marginTop: 0 }}>Boxes</h2>
                  {boxes.length === 0 ? (
                    <p>No box identifiers yet.</p>
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
                <div style={styles.card}>
                  <h2 style={{ marginTop: 0 }}>Tags</h2>
                  {tags.length === 0 ? (
                    <p>No tags yet.</p>
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
                  <div style={{ fontWeight: 800 }}>
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
                {!visibleItems.length && <p>No items found.</p>}
              </div>
            </section>
          </div>
        </>
      )}

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
              style={{ ...styles.input, minHeight: 90 }}
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

            {status && <p style={{ margin: 0 }}>{status}</p>}
          </form>
        </Modal>
      )}
    </main>
  );
}

/* ---------- UI Components ---------- */

function TopTab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 14px",
        borderRadius: 999,
        border: "1px solid #111827",
        fontWeight: 800,
        background: active ? "#111827" : "#f3f4f6",
        color: active ? "white" : "#111827",
      }}
    >
      {children}
    </button>
  );
}

function SubTab({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "8px 12px",
        borderRadius: 999,
        border: "1px solid #1f2937",
        fontWeight: 700,
        background: active ? "#1f2937" : "white",
        color: active ? "white" : "#1f2937",
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
        border: "1px solid #111827",
        fontWeight: 700,
        background: active ? "#111827" : "white",
        color: active ? "white" : "#111827",
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
        background: "rgba(0,0,0,0.45)",
        display: "grid",
        placeItems: "center",
        padding: 14,
        zIndex: 50,
      }}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        style={{
          width: "min(700px, 100%)",
          background: "white",
          borderRadius: 14,
          border: "1px solid #ddd",
          padding: 14,
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

  return (
    <div style={styles.card}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{item.name}</div>

          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
            Qty: {item.quantity || 1}
            {item.box_identifier ? ` • Box: ${item.box_identifier}` : ""}
            {item.folder_id ? ` • Folder: ${folderNameById.get(item.folder_id) || "Folder"}` : " • Unfiled"}
            {item.tags?.length ? ` • Tags: ${item.tags.join(", ")}` : ""}
          </div>

          {item.notes && <p style={{ marginTop: 8 }}>{item.notes}</p>}
        </div>

        <button onClick={() => onDelete(item.id)} style={styles.dangerBtn}>
          Delete
        </button>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Qty
          <input
            type="number"
            min="1"
            value={item.quantity || 1}
            onChange={(e) => onQty(item.id, e.target.value)}
            style={{ width: 80, padding: 8, borderRadius: 10, border: "1px solid #ddd" }}
          />
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Folder
          <select
            value={item.folder_id || "none"}
            onChange={(e) => onMove(item.id, e.target.value)}
            style={{ padding: 8, borderRadius: 10, border: "1px solid #ddd" }}
          >
            <option value="none">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {urls.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          {urls.map((u) => (
            <img
              key={u}
              src={u}
              alt=""
              style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 10 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Styles ---------- */

const styles = {
 card: {
  marginTop: 16,
  border: "1px solid #1f2937",
  borderRadius: 14,
  padding: 12,
  background: "#0b1220",     // dark card
  color: "#e5e7eb",          // light text inside card
  boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
},
  input: {
    padding: 10,
    borderRadius: 10,
    border: "1px solid #ddd",
  },
  primaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "#111827",
    color: "white",
    fontWeight: 800,
  },
  secondaryBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #111827",
    background: "white",
    color: "#111827",
    fontWeight: 800,
  },
  dangerBtn: {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid #991b1b",
    background: "#991b1b",
    color: "white",
    fontWeight: 800,
    height: "fit-content",
  },
  linkBtn: {
    padding: "8px 10px",
    borderRadius: 10,
    border: "1px solid transparent",
    background: "transparent",
    color: "#111827",
    fontWeight: 800,
    textDecoration: "underline",
  },
  sidebarBtn: {
    width: "100%",
    textAlign: "left",
    padding: 10,
    marginBottom: 8,
    borderRadius: 12,
    border: "1px solid #e5e7eb",
  },
};