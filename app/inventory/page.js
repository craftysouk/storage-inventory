"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function InventoryPage() {
  const router = useRouter();

  const [session, setSession] = useState(null);

  // Tabs
  const [view, setView] = useState("all"); // all | folders | boxes | tags

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

  // Item form
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
    // Pull everything once; filter client-side for now (simple + fast enough early)
    const { data, error } = await supabase
      .from("items")
      .select("id, name, quantity, box_identifier, notes, tags, folder_id, created_at, item_photos(path)")
      .order("created_at", { ascending: false });

    if (!error) setItems(data || []);
  }

  useEffect(() => {
    if (!session) return;
    loadFolders();
    loadItems();
  }, [session]);

  // When switching tabs, clear deep selections
  useEffect(() => {
    setSelectedBox(null);
    setSelectedTag(null);
    setSelectedFolderId("all");
    setQ("");
  }, [view]);

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
    const name = newFolderName.trim();
    if (!name) return;

    const { error } = await supabase.from("folders").insert([{ user_id: userId, name }]);
    if (error) return setFolderStatus(error.message);

    setNewFolderName("");
    setFolderStatus("Folder created!");
    await loadFolders();
    setTimeout(() => setFolderStatus(""), 1200);
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

    // reset
    setName("");
    setQuantity(1);
    setBoxIdentifier("");
    setNotes("");
    setTagsText("");
    setFolderId("");
    setFiles([]);

    setStatus("Saved!");
    await loadItems();
    setTimeout(() => setStatus(""), 1200);
  }

  async function moveItem(itemId, newFolderId) {
    const folder_id = newFolderId === "none" ? null : newFolderId;

    const { error } = await supabase
      .from("items")
      .update({ folder_id })
      .eq("id", itemId);

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

  // -------- Derived views ----------
  const folderNameById = useMemo(() => {
    const map = new Map();
    folders.forEach((f) => map.set(f.id, f.name));
    return map;
  }, [folders]);

  const boxes = useMemo(() => {
    // Unique box identifiers, sorted
    const set = new Set();
    items.forEach((it) => {
      if (it.box_identifier) set.add(it.box_identifier);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const tags = useMemo(() => {
    // Unique tags, sorted
    const set = new Set();
    items.forEach((it) => (it.tags || []).forEach((t) => set.add(t)));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const visibleItems = useMemo(() => {
    let list = items;

    // Folders tab: filter by folder selection
    if (view === "folders" && selectedFolderId !== "all") {
      list = list.filter((it) => it.folder_id === selectedFolderId);
    }

    // Boxes tab: filter by selected box
    if (view === "boxes" && selectedBox) {
      list = list.filter((it) => it.box_identifier === selectedBox);
    }

    // Tags tab: filter by selected tag
    if (view === "tags" && selectedTag) {
      list = list.filter((it) => (it.tags || []).includes(selectedTag));
    }

    // Search (works in any tab when list is showing)
    const s = q.trim().toLowerCase();
    if (!s) return list;

    return list.filter((it) => {
      const hay = `${it.name} ${it.box_identifier || ""} ${it.notes || ""} ${(it.tags || []).join(" ")}`.toLowerCase();
      return hay.includes(s);
    });
  }, [items, view, selectedFolderId, selectedBox, selectedTag, q]);

  return (
    <main style={{ maxWidth: 1100, margin: "20px auto", fontFamily: "system-ui", padding: 12 }}>
      {/* Top menu */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
        <h1 style={{ margin: 0 }}>Home Inventory</h1>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={signOut} style={{ padding: 10 }}>Sign Out</button>
        </div>
      </header>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <TabButton active={view === "all"} onClick={() => setView("all")}>All</TabButton>
        <TabButton active={view === "folders"} onClick={() => setView("folders")}>Folders</TabButton>
        <TabButton active={view === "boxes"} onClick={() => setView("boxes")}>Boxes</TabButton>
        <TabButton active={view === "tags"} onClick={() => setView("tags")}>Tags</TabButton>
      </div>

      {/* Layout */}
      <div style={{ display: "grid", gridTemplateColumns: view === "folders" ? "260px 1fr" : "1fr", gap: 16, marginTop: 16 }}>
        {/* FOLDERS SIDEBAR */}
        {view === "folders" && (
          <aside style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Folders</h3>

            <button
              onClick={() => setSelectedFolderId("all")}
              style={{
                width: "100%",
                textAlign: "left",
                padding: 10,
                marginBottom: 8,
                fontWeight: selectedFolderId === "all" ? 700 : 400,
              }}
            >
              All folders
            </button>

            {folders.map((f) => (
              <button
                key={f.id}
                onClick={() => setSelectedFolderId(f.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: 10,
                  marginBottom: 8,
                  fontWeight: selectedFolderId === f.id ? 700 : 400,
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
                style={{ padding: 10 }}
              />
              <button style={{ padding: 10 }}>Create folder</button>
              {folderStatus && <div style={{ fontSize: 13 }}>{folderStatus}</div>}
            </form>
          </aside>
        )}

        {/* MAIN */}
        <section>
          {/* Add item */}
          <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 16 }}>
            <h2 style={{ marginTop: 0 }}>Add item</h2>

            <form onSubmit={addItem} style={{ display: "grid", gap: 10 }}>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Item name *"
                style={{ padding: 10 }}
              />

              <div style={{ display: "grid", gap: 10, gridTemplateColumns: "140px 1fr" }}>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="Qty"
                  style={{ padding: 10 }}
                />
                <input
                  value={boxIdentifier}
                  onChange={(e) => setBoxIdentifier(e.target.value)}
                  placeholder="Box identifier (e.g., BX-012)"
                  style={{ padding: 10 }}
                />
              </div>

              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notes"
                style={{ padding: 10 }}
              />

              <input
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                placeholder="Tags (comma separated: kitchen, winter, tools)"
                style={{ padding: 10 }}
              />

              <select value={folderId} onChange={(e) => setFolderId(e.target.value)} style={{ padding: 10 }}>
                <option value="">No folder</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>

              <input type="file" multiple accept="image/*" onChange={(e) => setFiles(Array.from(e.target.files || []))} />

              <button style={{ padding: 12 }}>Save</button>
              {status && <p>{status}</p>}
            </form>
          </div>

          {/* Boxes tab: box list */}
          {view === "boxes" && !selectedBox && (
            <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <h2 style={{ marginTop: 0 }}>Boxes</h2>
              {boxes.length === 0 ? (
                <p>No box identifiers yet. Add an item with a Box identifier.</p>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {boxes.map((b) => (
                    <button key={b} onClick={() => setSelectedBox(b)} style={{ padding: "10px 12px", borderRadius: 999, border: "1px solid #ddd" }}>
                      {b}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tags tab: tag list */}
          {view === "tags" && !selectedTag && (
            <div style={{ border: "1px solid #ddd", borderRadius: 10, padding: 12, marginBottom: 16 }}>
              <h2 style={{ marginTop: 0 }}>Tags</h2>
              {tags.length === 0 ? (
                <p>No tags yet. Add tags to an item (comma separated).</p>
              ) : (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {tags.map((t) => (
                    <button key={t} onClick={() => setSelectedTag(t)} style={{ padding: "10px 12px", borderRadius: 999, border: "1px solid #ddd" }}>
                      {t}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* If selected box/tag, show a back button */}
          {(selectedBox || selectedTag) && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <button
                onClick={() => {
                  setSelectedBox(null);
                  setSelectedTag(null);
                  setQ("");
                }}
                style={{ padding: 10 }}
              >
                ← Back
              </button>
              <div style={{ fontWeight: 700 }}>
                {selectedBox ? `Box: ${selectedBox}` : ""}
                {selectedTag ? `Tag: ${selectedTag}` : ""}
              </div>
              <div />
            </div>
          )}

          {/* Search + list (always shown when list is shown) */}
          <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search name, tags, box, notes…"
              style={{ padding: 10, flex: 1 }}
            />
            <button onClick={loadItems} style={{ padding: 10 }}>Refresh</button>
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
            {!visibleItems.length && <p>No items found.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 999,
        border: "1px solid #ddd",
        fontWeight: active ? 700 : 400,
        background: active ? "#f3f3f3" : "white",
      }}
    >
      {children}
    </button>
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
    return () => { alive = false; };
  }, [item, getSignedUrl]);

  return (
    <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{item.name}</div>

          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>
            Qty: {item.quantity || 1}
            {item.box_identifier ? ` • Box: ${item.box_identifier}` : ""}
            {item.folder_id ? ` • Folder: ${folderNameById.get(item.folder_id) || "Folder"}` : " • Unfiled"}
            {item.tags?.length ? ` • Tags: ${item.tags.join(", ")}` : ""}
          </div>

          {item.notes && <p style={{ marginTop: 8 }}>{item.notes}</p>}
        </div>

        <button onClick={() => onDelete(item.id)} style={{ padding: 10 }}>
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
            style={{ width: 80, padding: 8 }}
          />
        </label>

        <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
          Folder
          <select
            value={item.folder_id || "none"}
            onChange={(e) => onMove(item.id, e.target.value)}
            style={{ padding: 8 }}
          >
            <option value="none">No folder</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>{f.name}</option>
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
              style={{ width: 110, height: 110, objectFit: "cover", borderRadius: 8 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}