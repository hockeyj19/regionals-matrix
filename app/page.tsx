"use client";

import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabaseClient";
import { Matrix } from "@/components/Matrix";

// Where password-reset links come back to. Derived from the browser at runtime,
// so it is always whatever URL the app is actually being served from - rename the
// Vercel project as often as you like and this never needs touching again. The
// literal is only the server-render fallback (auth all happens in the browser).
const SITE_URL =
  typeof window !== "undefined"
    ? window.location.origin
    : "https://tape-notes.vercel.app";

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // auth form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [message, setMessage] = useState("");

  // password reset state
  const [recovery, setRecovery] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setRecovery(true);
      }
      setUser(session?.user ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleForgotPassword() {
    if (!email) {
      setMessage("Enter your email above first, then click Forgot password.");
      return;
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: SITE_URL,
    });
    setMessage(error ? error.message : "Password reset email sent — check your inbox (and spam).");
  }

  async function handleSetNewPassword() {
    setMessage("");
    if (newPassword.length < 6) {
      setMessage("Password must be at least 6 characters.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      setMessage(error.message);
    } else {
      setRecovery(false);
      setNewPassword("");
      setMessage("Password updated — you're signed in.");
    }
  }

  async function handleAuth() {
    setMessage("");
    if (mode === "signup") {
      const { error } = await supabase.auth.signUp({ email, password });
      setMessage(error ? error.message : "Account created — you're in.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setMessage(error.message);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center">
        Loading…
      </main>
    );
  }

  if (recovery) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center">Set a new password</h1>
          <input
            type="password"
            placeholder="New password (min 6 characters)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-500"
          />
          <button
            onClick={handleSetNewPassword}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 font-medium"
          >
            Update password
          </button>
          {message && <p className="text-center text-sm text-amber-400">{message}</p>}
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4">
          <h1 className="text-2xl font-bold text-center">
            Tape Notes <span className="text-emerald-400 text-sm align-middle">beta</span>
          </h1>
          <p className="text-center text-neutral-400 text-sm">
            {mode === "signin" ? "Sign in to your account" : "Create an account"}
          </p>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-500"
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 outline-none focus:border-neutral-500"
          />
          <button
            onClick={handleAuth}
            className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3 py-2 font-medium"
          >
            {mode === "signin" ? "Sign in" : "Sign up"}
          </button>
          {message && <p className="text-center text-sm text-amber-400">{message}</p>}
          {mode === "signin" && (
            <button
              onClick={handleForgotPassword}
              className="w-full text-sm text-neutral-400 hover:text-neutral-200"
            >
              Forgot password?
            </button>
          )}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setMessage("");
            }}
            className="w-full text-sm text-neutral-400 hover:text-neutral-200"
          >
            {mode === "signin" ? "Need an account? Sign up" : "Have an account? Sign in"}
          </button>
        </div>
      </main>
    );
  }

  return <Matrix user={user} />;
}
