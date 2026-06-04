"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const LOGIN_COOLDOWN_MS = 3000;

export default function Home() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function restoreSession() {
      try {
        const response = await fetch("/api/auth/session", { credentials: "same-origin" });
        if (!response.ok || cancelled) return;
        const data = (await response.json()) as { redirect?: string };
        if (typeof data.redirect === "string" && !cancelled) {
          router.replace(data.redirect);
        }
      } catch {
        // Sem sessao salva — permanece na tela de login.
      }
    }
    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [router]);

  function startCooldown(durationMs: number) {
    if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
    const endsAt = Date.now() + durationMs;
    setCooldownRemaining(durationMs);
    cooldownTimerRef.current = setInterval(() => {
      const remaining = Math.max(0, endsAt - Date.now());
      setCooldownRemaining(remaining);
      if (remaining <= 0 && cooldownTimerRef.current) {
        clearInterval(cooldownTimerRef.current);
        cooldownTimerRef.current = null;
      }
    }, 100);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || cooldownRemaining > 0) return;
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        redirect?: string;
        retryAfterMs?: number;
      };

      if (!response.ok) {
        if (response.status === 429) {
          const ms = Number(data.retryAfterMs ?? LOGIN_COOLDOWN_MS);
          startCooldown(Number.isFinite(ms) && ms > 0 ? ms : LOGIN_COOLDOWN_MS);
          setError(data.error ?? "Aguarde antes de tentar novamente.");
          return;
        }
        if (typeof data.redirect === "string") {
          router.push(data.redirect);
          router.refresh();
          return;
        }
        setError(data.error ?? "Falha no login.");
        startCooldown(LOGIN_COOLDOWN_MS);
        return;
      }

      const redirectTo =
        typeof data.redirect === "string" ? data.redirect : "/painel";
      router.push(redirectTo);
      router.refresh();
    } catch {
      setError("Nao foi possivel conectar ao servidor. Tente novamente.");
      startCooldown(LOGIN_COOLDOWN_MS);
    } finally {
      setLoading(false);
    }
  }

  const cooldownSeconds = Math.ceil(cooldownRemaining / 1000);
  const isDisabled = loading || cooldownRemaining > 0;
  const buttonLabel = loading
    ? "Entrando..."
    : cooldownRemaining > 0
      ? `Aguarde ${cooldownSeconds}s...`
      : "Acessar dashboard";

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-x-hidden bg-[#FCEFF4] px-3 py-6 sm:px-4 sm:py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_18%,#f8cfe0_0%,transparent_28%),radial-gradient(circle_at_88%_20%,#f6d6e6_0%,transparent_30%),radial-gradient(circle_at_14%_82%,#f7cada_0%,transparent_28%),radial-gradient(circle_at_82%_78%,#f8dcea_0%,transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(0deg,transparent_24px,#f8dce6_25px),linear-gradient(90deg,transparent_24px,#f8dce6_25px)] bg-[size:25px_25px] opacity-40" />
      <img
        src="https://i.imgur.com/D1JcuES.png"
        alt="Pusheen decorativa"
        className="pointer-events-none absolute bottom-[8%] left-[10%] z-20 hidden w-[190px] select-none translate-x-[2.5cm] md:block md:bottom-[10%] md:left-[13%] md:w-[250px] md:translate-x-[2.5cm] lg:bottom-[12%] lg:left-[15%] lg:w-[290px] lg:translate-x-[2.5cm]"
        draggable={false}
      />
      <img
        src="https://i.imgur.com/BQe4HfO.png"
        alt="Ursinho decorativo"
        className="pointer-events-none absolute bottom-[calc(25%+0.2cm)] left-[7%] z-0 hidden w-[200px] select-none scale-[1.08] translate-x-[4.2cm] -rotate-[7deg] md:block md:bottom-[calc(28%+0.2cm)] md:left-[9%] md:w-[270px] md:scale-[1.08] md:translate-x-[4.2cm] lg:bottom-[calc(30%+0.2cm)] lg:left-[11%] lg:w-[320px] lg:scale-[1.08] lg:translate-x-[4.2cm]"
        draggable={false}
      />
      <img
        src="https://i.imgur.com/uF2R2k4.png"
        alt="Decoração lado direito"
        className="pointer-events-none absolute bottom-[8%] right-[10%] z-20 hidden w-[190px] select-none scale-[1.11] -translate-x-[1cm] md:block md:bottom-[10%] md:right-[13%] md:w-[250px] md:scale-[1.11] md:-translate-x-[1cm] lg:bottom-[12%] lg:right-[15%] lg:w-[290px] lg:scale-[1.11] lg:-translate-x-[1cm]"
        draggable={false}
      />
      <img
        src="https://i.imgur.com/L3e5Vhr.png"
        alt="Urso rosa decorativo"
        className="pointer-events-none absolute bottom-[27%] right-[22%] z-10 hidden w-[170px] select-none scale-[1.06] translate-x-[4.124cm] md:block md:bottom-[30%] md:right-[25%] md:w-[215px] md:scale-[1.06] md:translate-x-[4.124cm] lg:bottom-[32%] lg:right-[27%] lg:w-[250px] lg:scale-[1.06] lg:translate-x-[4.124cm]"
        draggable={false}
      />
      <div className="relative z-10 mx-auto w-full max-w-3xl px-1 pt-20 sm:pt-28 md:pt-32">
        <img
          src="https://i.imgur.com/v0POVO6.png"
          alt="Hello Kitty branca decorativa"
          className="pointer-events-none absolute left-0 top-[calc(0.5rem+1.8cm)] z-40 w-[108px] -translate-x-[6%] -translate-y-[42%] rotate-[8deg] select-none sm:left-1 sm:top-[1.8cm] sm:w-[150px] sm:-translate-x-[12%] sm:-translate-y-[48%] md:-left-3 md:w-[190px] lg:-left-5 lg:w-[220px] xl:w-[243px]"
          draggable={false}
        />
        <img
          src="https://i.imgur.com/K9ZmvDc.png"
          alt="Hello Kitty preta decorativa"
          className="pointer-events-none absolute right-0 top-[calc(0.75rem+1.8cm)] z-40 w-[102px] translate-x-[6%] -translate-y-[38%] select-none sm:right-1 sm:top-[calc(0.25rem+1.8cm)] sm:w-[142px] sm:translate-x-[10%] sm:-translate-y-[44%] md:-right-3 md:w-[185px] lg:-right-5 lg:w-[215px] xl:w-[235px]"
          draggable={false}
        />
        <section className="relative rounded-[2rem] border border-[#f3c7d9] bg-[#fff9fc]/95 p-3 shadow-[0_20px_55px_rgba(232,141,177,0.38)] sm:rounded-[2.4rem] sm:p-4 md:p-6">
          <div className="relative rounded-[1.5rem] border border-[#f4cfde] bg-[#fffdfd] px-4 py-5 sm:rounded-[1.8rem] sm:px-5 sm:py-6 md:px-8 md:py-8">
          <span className="inline-flex items-center rounded-full border border-[#f2b8cf] bg-[#ffe8f2] px-3 py-1 text-xs text-[#d56a97]">
            area privada
          </span>

          <img
            src="https://i.imgur.com/GT1qXj6.png"
            alt="Hots"
            className="mx-auto mt-4 w-[150px] select-none sm:w-[180px] md:w-[230px] lg:w-[270px]"
            draggable={false}
          />

          <p className="mx-auto mt-4 max-w-xl text-center text-sm leading-relaxed text-[#9f6e84]">
            Cresca conosco! Este painel privado foi criado para a equipe escolhida
            pela Bel registrar comprovantes e acompanhar resultados com organizacao.
          </p>

          <form className="mx-auto mt-7 grid max-w-xl gap-4" onSubmit={onSubmit} autoComplete="off">
            <label className="grid gap-2 text-sm text-[#99657d]">
              Usuario
              <input
                className="rounded-2xl border border-[#f2c9d8] bg-white px-4 py-3 text-sm text-[#86546a] outline-none ring-[#f4a8c4] placeholder:text-[#d7a5bb] focus:ring-2"
                placeholder="Digite seu usuario"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                required
              />
            </label>

            <label className="grid gap-2 text-sm text-[#99657d]">
              Senha
              <input
                type="password"
                className="rounded-2xl border border-[#f2c9d8] bg-white px-4 py-3 text-sm text-[#86546a] outline-none ring-[#f4a8c4] placeholder:text-[#d7a5bb] focus:ring-2"
                placeholder="Digite sua senha"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            {error ? (
              <p className="rounded-xl border border-[#f2aac0] bg-[#fff0f5] p-2 text-sm text-[#c04672]">
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={isDisabled}
              className="mt-2 rounded-2xl border border-[#ef8fb2] bg-gradient-to-r from-[#f8a3c2] via-[#f38db3] to-[#ef80aa] px-4 py-3 text-sm text-white shadow-[0_10px_20px_rgba(239,128,170,0.35)] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {buttonLabel}
            </button>
            <p className="text-center text-[11px] text-[#ae7c92]">
              Por seguranca, ha um intervalo minimo entre tentativas de login.
            </p>
          </form>
          </div>
        </section>
      </div>
    </main>
  );
}
