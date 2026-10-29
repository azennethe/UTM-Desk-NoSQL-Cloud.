// Rol activo de la sesión, adaptado del patrón de Innovaplay (activeRole_<id> en localStorage,
// autoSelectBestRole() y getRoleDashboardPath()). El conjunto `roles` del usuario es lo que
// autoriza en el servidor; el rol activo manda en la navegación y en la vista de aterrizaje.
export const PRIORIDAD_ROL = ['soporte_ti', 'tecnico', 'directivo', 'reportante'];

// Equivalente a ROLE_COLORS / NAV_BY_ROLE del proyecto de referencia. La lista de cada rol
// reproduce exactamente el menú que hoy obtiene una cuenta con un solo rol.
export const PUNTO_ROL: any = {
  soporte_ti: 'bg-emerald-600',
  tecnico: 'bg-sky-600',
  directivo: 'bg-amber-600',
  reportante: 'bg-slate-400',
};

export const VISTA_ROL: any = {
  soporte_ti: 'inicio',
  tecnico: 'inicio',
  reportante: 'lista',
  directivo: 'stats',
};

export const NAV_ROL: any = {
  soporte_ti: ['inicio', 'lista', 'pendientes', 'usuarios', 'stats', 'kb'],
  tecnico: ['inicio', 'lista', 'kb'],
  reportante: ['inicio', 'lista', 'nueva', 'kb'],
  directivo: ['stats', 'kb'],
};

export const rolActivo = (u: any, roles: string[]): string => {
  if (!roles.length) return u?.rol || 'reportante';
  const guardado = u?.id ? localStorage.getItem('activeRole_' + u.id) : null;
  if (guardado && roles.includes(guardado)) return guardado;
  if (u?.rol && roles.includes(u.rol)) return u.rol;
  return PRIORIDAD_ROL.find(r => roles.includes(r)) || roles[0];
};

export const fijarRolActivo = (id: any, rol: string) => {
  if (id) localStorage.setItem('activeRole_' + id, rol);
};

// Al cambiar de cuenta en el mismo navegador no debe quedar el rol elegido por la anterior.
export const olvidarRolActivo = (id: any) => {
  if (id) localStorage.removeItem('activeRole_' + id);
};
