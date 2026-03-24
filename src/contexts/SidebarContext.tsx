import { createContext, useContext, useState, ReactNode, useEffect } from 'react';

interface SidebarContextType {
  collapsed: boolean;
  mobileOpen: boolean;
  isMobile: boolean;
  toggle: () => void;
  setMobileOpen: (open: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  mobileOpen: false,
  isMobile: false,
  toggle: () => {},
  setMobileOpen: () => {},
});

export const useSidebarState = () => useContext(SidebarContext);

export const SidebarProvider = ({ children }: { children: ReactNode }) => {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Close mobile sidebar on resize to desktop
  useEffect(() => {
    if (!isMobile) setMobileOpen(false);
  }, [isMobile]);

  return (
    <SidebarContext.Provider value={{
      collapsed,
      mobileOpen,
      isMobile,
      toggle: () => isMobile ? setMobileOpen(o => !o) : setCollapsed(c => !c),
      setMobileOpen,
    }}>
      {children}
    </SidebarContext.Provider>
  );
};
