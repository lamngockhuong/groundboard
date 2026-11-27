export function AppLayout({ children }: { children: React.ReactNode }) {
  const logout = useLogout();
  return (
    <div>
      <header>
        <a href="/">Shop</a>
        <button type="button" onClick={() => logout.mutate()}>
          Log out
        </button>
      </header>
      <main>{children}</main>
      <footer>
        <a href="/privacy">Privacy policy</a>
      </footer>
    </div>
  );
}
