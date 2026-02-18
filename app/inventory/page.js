"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabaseClient";

export default function InventoryPage() {
  const router = useRouter();

  const [session, setSession] = useState(null);
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");

  // form fields
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [unit, setUnit] = useState("");
  const [section, setSection] = useState("");
  const [box, setBox] = useState("");
  const [notes, setNotes] = useState("");
  const [files, setFiles] = useState([]);
  const [status, setStatus] = useState("");

  // Protect page: require auth
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

  async function loadItems() {
    const { data, error } = await supabase
      .from("items")
      .select("id, name, category, unit, section, box, notes, created_at, item_photos(path)")
      .order("created_at", { ascending: false });

    if (!error) setItems(data || []);
  }

  useEffect(() => {
    if (session) loadItems();
  }, [session]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;

    return items.filter((it) => {
      const hay = `${it.name} ${it.category || ""} ${it.unit || ""} ${it.section || ""} ${
        it.box || ""
      } ${it.notes || ""}`.toLowerCase();
      return hay.includes(s);
    });
  }, [items, q]);

  async function getSignedUrl(path) {
    const { data, error } = await supabase.storage
      .from("item-photos")
      .createSignedUrl(path, 60 * 60); // 1 hour

    if (error) return "";
    return data?.signedUrl || "";
  }

  async function addItem(e) {
    e.preventDefault();
    setStatus("Saving...");

    if (!session) return;

    const userId = session.user.id;

    // 1) Create item row and get it back
    const { data: created, error: itemErr } = await supabase
      .from("items")
      .insert([{ user_id: userId, name, category, unit, section, box, notes }])
      .select()
      .single();

    if (itemErr) {
      setStatus(itemErr.message);
      return;
    }

    // 2) Upload photos + insert photo rows
    for (const file of files) {
      const ext = file.name.split(".").pop() || "jpg";
      const fileName = `${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;
      const path = `${userId}/${created.id}/${fileName}`;

      const { error: upErr } = await supabase.storage
        .from("item-photos")
        .upload(path, file, { upsert: false });

      if (upErr) {
        setStatus(upErr.message);
        return;
      }

      const { error: photoErr } = await supabase
        .from("item_photos")
        .insert([{ item_id: created.id, user_id: userId, path }]);

      if (photoErr) {
        setStatus(photoErr.message);
        return;
      }
    }

    // Reset form + reload
    setName("");
    setCategory("");
    setUnit("");
    setSection("");
    setBox("");
    setNotes("");
    setFiles([]);
    setStatus("Saved!");
    await loadItems();
    setTimeout(() => setStatus(""), 1200);
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <main style={{ maxWidth: 950, margin: "30px auto", fontFamily: "system-ui", padding: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1>Inventory</h1>
        <button onClick={signOut} style={{ padding: 10 }}>
          Sign Out
        </button>
      </header>

      {/* Add item */}
      <section style={{ border: "1px solid #ddd", padding: 14, borderRadius: 10, marginBottom: 18 }}>
        <h2 style={{ marginTop: 0 }}>Add item</h2>

        <form onSubmit={addItem} style={{ display: "grid", gap: 10 }}>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name *"
            style={{ padding: 10 }}
          />

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Category"
              style={{ padding: 10 }}
            />
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Storage unit / Location"
              style={{ padding: 10 }}
            />
          </div>

          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
            <input
              value={section}
              onChange={(e) => setSection(e.target.value)}
              placeholder="Section (e.g., back left)"
              style={{ padding: 10 }}
            />
            <input
              value={box}
              onChange={(e) => setBox(e.target.value)}
              placeholder="Box (e.g., Box 12)"
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
            type="file"
            multiple
            accept="image/*"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />

          <button style={{ padding: 12 }}>Save</button>
          {status && <p>{status}</p>}
        </form>
      </section>

      {/* Search + list */}
      <section>
        <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search (name, box, notes, etc.)"
            style={{ padding: 10, flex: 1 }}
          />
          <button onClick={loadItems} style={{ padding: 10 }}>
            Refresh
          </button>
        </div>

        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map((it) => (
            <ItemCard key={it.id} item={it} getSignedUrl={getSignedUrl} />
          ))}
          {!filtered.length && <p>No items found.</p>}
        </div>
      </section>
    </main>
  );
}

function ItemCard({ item, getSignedUrl }) {
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
    <div style={{ border: "1px solid #ddd", padding: 12, borderRadius: 10 }}>
      <div style={{ fontWeight: 700 }}>{item.name}</div>

      <div style={{ fontSize: 14, opacity: 0.85, marginTop: 4 }}>
        {[item.category, item.unit, item.section, item.box].filter(Boolean).join(" • ")}
      </div>

      {item.notes && <p style={{ marginTop: 8 }}>{item.notes}</p>}

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