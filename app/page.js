"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabaseClient";

export default function Home() {
const router = useRouter();

useEffect(() => {
  supabase.auth.getSession().then(({ data }) => {
    if (data.session) {
      router.push("/inventory");
    }
  });
}, [router]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  async function signUp() {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Check your email to confirm your account.");
    }
  }

  async function signIn() {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      router.push("/inventory");
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: "50px auto", fontFamily: "system-ui" }}>
      <h1>Storage Inventory</h1>

      <input
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
      />

      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        style={{ width: "100%", padding: 10, marginBottom: 10 }}
      />

      <div style={{ display: "flex", gap: 10 }}>
        <button onClick={signIn} style={{ flex: 1, padding: 10 }}>
          Sign In
        </button>
        <button onClick={signUp} style={{ flex: 1, padding: 10 }}>
          Sign Up
        </button>
      </div>

      {message && <p style={{ marginTop: 20 }}>{message}</p>}
    </main>
  );
}