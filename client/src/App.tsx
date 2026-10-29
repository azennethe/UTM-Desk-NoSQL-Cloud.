import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { api, excel, estado } from './api';
import {
  NAV_ROL,
  PUNTO_ROL,
  VISTA_ROL,
  fijarRolActivo,
  olvidarRolActivo,
  rolActivo,
} from './roles';
import {
  saveDraft,
  syncDrafts,
  countDrafts,
  toFD,
} from './offline';

// ============================================================
// 1. CONSTANTES Y ESTILOS
// ============================================================

const CATS = [
  'Cómputo y telecomunicaciones',
  'Infraestructura física y mantenimiento',
  'Sistemas y servicios académicos',
];

const PRIOS = ['Baja', 'Media', 'Alta', 'Urgente'];

const ESTADOS = [
  'Abierta',
  'En proceso',
  'En espera',
  'Resuelta',
  'Cerrada',
];

// Espejo de TRANSICIONES en server/index.js: la API rechaza cualquier otro cambio
const TRANSICIONES: any = {
  Abierta: ['En proceso', 'En espera', 'Cerrada'],
  'En proceso': ['En espera', 'Resuelta'],
  'En espera': ['En proceso', 'Resuelta', 'Cerrada'],
  Resuelta: ['Cerrada', 'En proceso'],
  Cerrada: [],
};

const EDIF = [
  'Edificio A',
  'Edificio B',
  'Edificio C',
  'Edificio D',
  'Biblioteca',
  'Rectoría',
];

// El catálogo de arriba es el de demostración. En un clúster real hay edificios distintos, así que
// los selectores de *Ubicación* se completan con lo que responde `GET /edificios`; sin eso, elegir
// un edificio con expedientes era imposible y el filtro devolvía una tabla vacía.
const claveEdificio = (x: string) =>
  String(x).trim().toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');

const uneEdificios = (a: string[], b: string[]) => {
  const vistos = new Set(a.map(claveEdificio));
  const extra = [];
  for (const x of b || []) {
    if (!x || vistos.has(claveEdificio(x))) continue;
    vistos.add(claveEdificio(x));
    extra.push(x);
  }
  return [...a, ...extra];
};

let EDIF_CACHE: Promise<string[]> | null = null;

const useEdificios = () => {
  const [lista, setLista] = useState<string[]>(EDIF);

  useEffect(() => {
    let vivo = true;
    EDIF_CACHE ||= api('/edificios').catch(() => []);
    EDIF_CACHE.then((r: any) => vivo && setLista(uneEdificios(EDIF, Array.isArray(r) ? r : [])));
    return () => {
      vivo = false;
    };
  }, []);

  return lista;
};

const inp =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15 placeholder:text-slate-400';

const btn =
  'rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 disabled:cursor-not-allowed disabled:opacity-50';

const ghost =
  'rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500 disabled:cursor-not-allowed disabled:opacity-40';

const lbl =
  'mb-1 block text-[11px] font-medium uppercase tracking-wider text-slate-500';

// Espejo local de server/archivos.js. Solo adelanta al usuario lo que la API valida y
// clasifica de todos modos: el bucket lo decide la operación en el servidor, nunca aquí.
const IMG = ['image/jpeg', 'image/png', 'image/webp'];
const DOC = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];
const LIM_IMG = 10e6, LIM_DOC = 20e6, LIM_FOTO = 5e6;
const ACEPTA_EV = '.jpg,.jpeg,.png,.webp,.pdf,.doc,.docx,.xls,.xlsx,.txt';
const ACEPTA_FOTO = '.jpg,.jpeg,.png,.webp';
const cupo = (f: File) =>
  IMG.includes(f.type) ? f.size <= LIM_IMG : DOC.includes(f.type) ? f.size <= LIM_DOC : false;
const destino = (t: string) => (IMG.includes(t) ? 'incidencias-evidencias' : 'incidencias-documentos');

const PC: any = {
  Urgente: 'bg-red-50 text-red-700',
  Alta: 'bg-orange-50 text-orange-700',
  Media: 'bg-blue-50 text-blue-700',
  Baja: 'bg-slate-100 text-slate-600',
};

const EC: any = {
  Abierta: 'bg-red-50 text-red-700',
  'En proceso': 'bg-blue-50 text-blue-700',
  'En espera': 'bg-amber-50 text-amber-700',
  Resuelta: 'bg-emerald-50 text-emerald-700',
  Cerrada: 'bg-slate-100 text-slate-600',
};

const SLA: any = {
  Baja: '48h',
  Media: '24h',
  Alta: '8h',
  Urgente: '< 2h',
};

const SH: any = {
  [CATS[0]]: 'Cómputo y Redes',
  [CATS[1]]: 'Infraestructura',
  [CATS[2]]: 'Sistemas y SISE',
};

const ROLES = ['reportante', 'tecnico', 'soporte_ti', 'directivo'];

const ROL_LABEL: any = {
  reportante: 'Reportante',
  tecnico: 'Técnico',
  soporte_ti: 'Soporte TI',
  directivo: 'Directivo',
};

const ROL_DESC: any = {
  reportante: 'Registra incidencias y da seguimiento a las suyas.',
  tecnico: 'Atiende únicamente las incidencias que se le asignan.',
  soporte_ti: 'Autoriza, asigna, cierra expedientes y administra cuentas.',
  directivo: 'Consulta analítica agregada, sin expedientes personales.',
};

const fcha = (x: any, corto = false) =>
  x
    ? new Date(x).toLocaleString('es-MX', corto
      ? { dateStyle: 'short' }
      : { dateStyle: 'short', timeStyle: 'short' })
    : '—';

// Espejo exacto de CAMPOS_CATEGORIA en server/index.js
const CAMPOS_CAT: any = {
  [CATS[0]]: [
    { k: 'tipo_equipo', l: 'Tipo de equipo', req: true, ph: 'Ej. Laptop, switch, proyector' },
    { k: 'equipos_afectados', l: 'Equipos afectados', req: true, ph: 'Ej. 3 equipos del LAB-2' },
    { k: 'direccion_ip', l: 'Dirección IP', ph: 'Ej. 192.168.10.25' },
    { k: 'vlan', l: 'VLAN', ph: 'Ej. 10 (entero 1-4094)' },
  ],
  [CATS[1]]: [
    { k: 'tipo_infraestructura', l: 'Tipo de infraestructura', req: true, ph: 'Ej. Climatización, cableado' },
    { k: 'area_afectada', l: 'Área afectada', req: true, ph: 'Ej. Piso 2, pasillo norte' },
    { k: 'riesgo_estructural', l: '¿Riesgo estructural?', opt: ['No', 'Sí'] },
    { k: 'requiere_tercero', l: '¿Requiere proveedor externo?', opt: ['No', 'Sí'] },
  ],
  [CATS[2]]: [
    { k: 'sistema_afectado', l: 'Sistema o plataforma', req: true, ph: 'Ej. SISE, Moodle' },
    { k: 'tipo_falla', l: 'Tipo de falla', req: true, ph: 'Ej. Login, lentitud, caída' },
    { k: 'usuarios_afectados', l: 'Usuarios afectados', ph: 'Ej. 40 alumnos' },
    { k: 'modulo', l: 'Módulo afectado', ph: 'Ej. Inscripciones' },
  ],
};

// Modelo multirol: `roles` es el conjunto que autoriza y `rol` es el activo (el que se muestra
// como etiqueta). Los permisos se evalúan como unión del conjunto, igual que en el servidor.
const rolesDe = (u: any): string[] => {
  const lista: string[] = u?.roles?.length ? u.roles : [u?.rol];
  return [...new Set(lista.filter(Boolean))];
};
const tiene = (u: any, ...rs: string[]) => rolesDe(u).some((r) => rs.includes(r));
// Etiqueta legible del conjunto: "Soporte TI · Técnico".
const etiquetaRoles = (u: any) =>
  rolesDe(u).map((r) => ROL_LABEL[r] || r).join(' · ') || 'Sin rol';

// Roles que intervienen incidencias, los que las gestionan y los que ven analítica
const interviene = (u: any) => tiene(u, 'tecnico', 'soporte_ti');
const gestiona = (u: any) => tiene(u, 'soporte_ti');
const veStats = (u: any) => tiene(u, 'soporte_ti', 'directivo');
const reporta = (u: any) => tiene(u, 'reportante');

// ============================================================
// 2. COMPONENTES REUTILIZABLES DE INTERFAZ
// ============================================================

const Card = ({ children, className = '' }: any) => (
  <div
    className={
      'app-card rounded-xl border border-slate-200 bg-white ' + className
    }
  >
    {children}
  </div>
);

const Err = ({ m }: any) =>
  m ? (
    <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {m}
    </p>
  ) : null;

const Ok = ({ m }: any) =>
  m ? (
    <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      {m}
    </p>
  ) : null;

// La foto de perfil vive en un bucket privado: solo existe como URL firmada que la API entrega
// por GET /users/:id/avatar (el dueño o Soporte TI). Se pide una vez por cuenta y se cachea,
// porque esa firma caduca a la hora y repetir la llamada en cada render saldría cara.
const AVATAR = new Map<string, string | null>();

const avatarFirmado = async (id: string) => {
  if (AVATAR.has(id)) return AVATAR.get(id) ?? null;
  try {
    const d: any = await api(`/users/${id}/avatar`);
    const u = d?.avatar?.url || null;
    AVATAR.set(id, u);
    return u;
  } catch {
    return null;
  }
};

const Avatar = ({ id, nombre, src, cls = 'h-8 w-8 text-xs' }: any) => {
  const [url, setUrl] = useState<string | null>(
    src !== undefined ? src : id ? AVATAR.get(id) ?? null : null,
  );

  useEffect(() => {
    // El cleanup va primero: un efecto que devuelve un valor (aquí el resultado de setUrl)
    // confunde a React y deja la vista colgada.
    let vivo = true;
    if (src !== undefined) {
      setUrl(src);
    } else if (!id) {
      setUrl(null);
    } else {
      avatarFirmado(id).then((u) => vivo && setUrl(u));
    }
    return () => {
      vivo = false;
    };
  }, [id, src]);

  const inicial = String(nombre || '?').trim().charAt(0).toUpperCase();

  return url ? (
    <img
      src={url}
      alt={`Foto de perfil de ${nombre || 'la cuenta'}`}
      onError={() => setUrl(null)}
      className={cls + ' shrink-0 rounded-full object-cover'}
    />
  ) : (
    <span
      aria-hidden="true"
      className={cls + ' grid shrink-0 place-items-center rounded-full bg-slate-100 font-semibold text-slate-500'}
    >
      {inicial}
    </span>
  );
};

// Una pantalla que el conjunto de roles no autoriza se explica en lugar de quedar en blanco:
// con varios roles, saber qué rol falta es la única pista útil para el usuario.
const SinRol = ({ roles, accion }: any) => (
  <div className="space-y-4">
    <Page
      t="Acción no disponible"
      s={`Tu cuenta (${roles}) no incluye el rol necesario para ${accion}.`}
    />

    <Card className="p-5 text-sm text-slate-600">
      Pide a un perfil de <b>Soporte TI</b> que te asigne el rol desde{' '}
      <b>Usuarios → Asignar roles</b>. Si tú eres Soporte TI, abre esa misma pantalla sobre tu
      propia cuenta y marca el rol que necesitas; el cambio se aplica sin cerrar la sesión.
    </Card>
  </div>
);

const Pill = ({
  t,
  c = 'bg-emerald-50 text-emerald-700',
}: any) => (
  <span
    className={
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ' +
      c
    }
  >
    {t}
  </span>
);

const Tag = ({ t }: any) => (
  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
    #{t}
  </span>
);

const Lbl = ({ children }: any) => (
  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wider text-slate-500">
    {children}
  </span>
);

// Fuera de las vistas y controlado: un <select> definido dentro de
// un componente cambia de identidad en cada render, React lo
// desmonta y el valor vuelve al primer <option> («Todos»).
const Sel = ({ l, o, all, v, on }: any) => (
  <label className="block">
    <Lbl>{l}</Lbl>

    <select
      className={inp}
      aria-label={l}
      value={v ?? ''}
      onChange={(x) => on(x.target.value)}
    >
      <option value="">{all}</option>

      {o.map((x: string) => (
        <option key={x}>{x}</option>
      ))}
    </select>
  </label>
);

const Head = ({ n, t, s }: any) => (
  <div className="mb-5 flex items-center gap-3">
    <span className="grid h-6 w-6 place-items-center rounded-md bg-emerald-700 text-xs font-semibold text-white">
      {n}
    </span>

    <div>
      <h3 className="text-sm font-semibold text-slate-900">
        {t}
      </h3>
      <p className="text-xs text-slate-500">{s}</p>
    </div>
  </div>
);

const Page = ({ t, s }: any) => (
  <div className="page-header reveal mb-6">
    <h1>
      {t}
    </h1>

    {s && (
      <p>
        {s}
      </p>
    )}
  </div>
);

// ============================================================
// 3. AUTENTICACIÓN: INICIO DE SESIÓN Y REGISTRO
// ============================================================

function Login({ onLogin }: any) {
  const [reg, setReg] = useState(false);

  const [f, setF] = useState({
    nombre: '',
    email: '',
    password: '',
  });

  const [e, setE] = useState('');
  const [b, setB] = useState(false);
  const [ver, setVer] = useState(false);

  const go = async () => {
    setE('');
    setB(true);

    try {
      const d = await api(
        reg ? '/auth/register' : '/auth/login',
        {
          method: 'POST',
          body: f,
        }
      );

      localStorage.setItem('t', d.token);
      onLogin(d.user);
    } catch (x: any) {
      setE(x.message);
    }

    setB(false);
  };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-50 p-4">
      <Card className="w-full max-w-sm space-y-5 p-8">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-700 text-lg font-bold text-white">
            U
          </span>

          <div>
            <h1 className="text-base font-semibold text-slate-900">
              UTM Desk
            </h1>
            <p className="text-xs text-slate-500">
              NoSQL Cloud Helpdesk
            </p>
          </div>
        </div>

        <p className="text-sm font-medium text-slate-700">
          {reg ? 'Crear cuenta de usuario' : 'Iniciar sesión'}
        </p>

        <Err m={e} />

        <div className="space-y-3">
          {reg && (
            <div>
              <label className={lbl} htmlFor="l-nombre">
                Nombre completo
              </label>

              <input
                id="l-nombre"
                className={inp}
                autoComplete="name"
                value={f.nombre}
                onChange={(x) =>
                  setF({ ...f, nombre: x.target.value })
                }
              />
            </div>
          )}

          <div>
            <label className={lbl} htmlFor="l-email">
              Correo institucional
            </label>

            <input
              id="l-email"
              className={inp}
              type="email"
              autoComplete="username"
              value={f.email}
              onChange={(x) =>
                setF({ ...f, email: x.target.value })
              }
            />
          </div>

          <div>
            <label className={lbl} htmlFor="l-pass">
              Contraseña
            </label>

            <div className="relative">
              <input
                id="l-pass"
                className={inp + ' pr-16'}
                type={ver ? 'text' : 'password'}
                autoComplete={reg ? 'new-password' : 'current-password'}
                value={f.password}
                onChange={(x) =>
                  setF({ ...f, password: x.target.value })
                }
                onKeyDown={(x) => x.key === 'Enter' && go()}
              />

              <button
                type="button"
                className="absolute inset-y-0 right-0 px-3 text-xs font-medium text-slate-500 hover:text-slate-800"
                aria-label={ver ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                onClick={() => setVer(!ver)}
              >
                {ver ? 'Ocultar' : 'Mostrar'}
              </button>
            </div>

            {reg && (
              <p className="mt-1 text-xs text-slate-500">
                Mínimo 8 caracteres. Queda cifrada con bcrypt.
              </p>
            )}
          </div>
        </div>

        <button
          className={btn + ' w-full'}
          disabled={b}
          onClick={go}
        >
          {b
            ? 'Enviando…'
            : reg
              ? 'Registrarme'
              : 'Entrar'}
        </button>

        <p className="text-center text-xs text-slate-500">
          {reg ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?'}{' '}
          <button
            className="font-medium text-emerald-700 hover:underline"
            onClick={() => setReg(!reg)}
          >
            {reg ? 'Inicia sesión' : 'Regístrate'}
          </button>
        </p>
      </Card>
    </div>
  );
}

// ============================================================
// 4. TABLA GENERAL DE INCIDENCIAS
// ============================================================

function Tabla({ items, go }: any) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wider text-slate-500">
          <tr>
            {[
              'Folio / Fecha',
              'Título y resumen',
              'Categoría',
              'Prioridad',
              'Ubicación',
              'Reportante',
              'Estado',
            ].map((h) => (
              <th
                key={h}
                className="border-b border-slate-200 px-4 py-2.5 font-medium"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {items.map((i: any) => (
            <tr
              key={i._id}
              className="cursor-pointer border-b border-slate-100 align-top transition-colors last:border-0 hover:bg-slate-50 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-600"
              tabIndex={0}
              aria-label={`Abrir ${i.folio} — ${i.titulo}`}
              onClick={() =>
                go({ v: 'detalle', id: i._id })
              }
              onKeyDown={(x) => {
                if (x.key === 'Enter' || x.key === ' ') {
                  x.preventDefault();
                  go({ v: 'detalle', id: i._id });
                }
              }}
            >
              <td className="px-4 py-3">
                <p className="font-mono text-xs font-medium text-slate-800">
                  {i.folio}
                </p>

                <p className="mt-0.5 text-xs text-slate-400">
                  {new Date(i.createdAt).toLocaleString()}
                </p>
              </td>

              <td className="max-w-xs px-4 py-3">
                <p className="font-medium text-slate-900">
                  {i.titulo}
                </p>

                <p className="mt-0.5 line-clamp-1 text-xs text-slate-500">
                  {i.descripcion}
                </p>

                <div className="mt-1.5 flex flex-wrap gap-1">
                  {(i.etiquetas || [])
                    .slice(0, 3)
                    .map((t: string) => (
                      <Tag key={t} t={t} />
                    ))}
                </div>
              </td>

              <td className="px-4 py-3">
                <Pill
                  t={SH[i.categoria] || i.categoria}
                  c="bg-slate-100 text-slate-600"
                />
              </td>

              <td className="px-4 py-3">
                <Pill
                  t={i.prioridad}
                  c={PC[i.prioridad]}
                />
              </td>

              <td className="px-4 py-3 text-xs">
                <p className="text-slate-700">
                  {i.edificio}
                </p>
                <p className="text-slate-400">
                  {i.espacio}
                </p>
              </td>

              <td className="px-4 py-3 text-xs">
                <p className="text-slate-700">
                  {i.reportante?.nombre}
                </p>
                <p className="text-slate-400">
                  {i.reportante?.email}
                </p>
              </td>

              <td className="px-4 py-3">
                <Pill
                  t={i.estado}
                  c={EC[i.estado]}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!items.length && (
        <p className="p-8 text-center text-sm text-slate-400">
          Sin resultados
        </p>
      )}
    </div>
  );
}

// ============================================================
// 5. PANEL PRINCIPAL
// ============================================================

function Dashboard({ user, go, enAtlas }: any) {
  const [s, setS] = useState<any>(null);
  const [r, setR] = useState<any>({ items: [] });
  const [e, setE] = useState('');

  const staff = veStats(user);

  useEffect(() => {
    api('/incidencias')
      .then(setR)
      .catch((x) => setE(x.message));

    if (staff) {
      api('/stats')
        .then(setS)
        .catch((x) => setE(x.message));
    }
  }, []);

  const n = (...k: string[]) =>
    (s?.porEstado || [])
      .filter((x: any) => k.includes(x._id))
      .reduce(
        (a: number, x: any) => a + x.n,
        0
      );

  const T = s?.tiempoPorEdificio || [];

  const avg = T.length
    ? T.reduce(
        (a: number, x: any) =>
          a + x.horasPromedio * x.n,
        0
      ) / T.reduce(
        (a: number, x: any) => a + x.n,
        0
      )
    : 0;

  const K = [
    ['Incidencias abiertas', n('Abierta')],
    ['En proceso / espera', n('En proceso', 'En espera')],
    ['Resueltas', n('Resuelta', 'Cerrada')],
    ['Tiempo medio de resolución', avg.toFixed(1) + ' h'],
  ];

  const encabezado =
    gestiona(user)
      ? ['Centro de monitoreo', 'Estado operativo del campus y incidencias priorizadas.']
      : tiene(user, 'tecnico')
        ? ['Mi bandeja de trabajo', 'Incidencias asignadas a ti, ordenadas por fecha.']
        : [`Hola, ${user.nombre}`, 'Consulta el avance de tus reportes o registra uno nuevo.'];

  return (
    <div>
      <Page t={encabezado[0]} s={encabezado[1]} />

      <Err m={e} />

      {staff && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {K.map(([l, v]) => (
            <Card key={l} className="p-5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
                {l}
              </p>

              <p className="mt-2 text-2xl font-semibold tabular-nums text-slate-900">
                {v}
              </p>
            </Card>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {gestiona(user)
                ? 'Incidencias prioritarias recientes'
                : tiene(user, 'tecnico')
                  ? 'Asignadas a ti'
                  : 'Mis incidencias recientes'}
            </h2>

            <p className="text-xs text-slate-500">
              Documentos indexados en{' '}
              {enAtlas ? 'MongoDB Atlas' : 'la base conectada'}
            </p>
          </div>

          <Pill
            t={(r.total ?? r.items.length) + ' registros'}
            c="bg-slate-100 text-slate-600"
          />
        </div>

        <Tabla
          items={(r.items || []).slice(0, 5)}
          go={go}
        />
      </Card>
    </div>
  );
}

// ============================================================
// 6. LISTADO, BÚSQUEDA Y FILTROS
// ============================================================

function Lista({ go, init, user, soloPendientes }: any) {
  const [d, setD] = useState<any>({
    items: [],
    pages: 1,
    total: 0,
  });

  const [f, setF] = useState<any>({
    page: 1,
    q: init,
    ...(soloPendientes ? { autorizacion: 'pendiente' } : {}),
  });

  const [e, setE] = useState('');

  const edificios = useEdificios();

  useEffect(() => {
    const q = new URLSearchParams(
      Object.entries(f).filter(([, v]) => v) as any
    );

    api('/incidencias?' + q)
      .then(setD)
      .catch((x) => setE(x.message));
  }, [f]);

  const set =
    (k: string) => (value: string) =>
      setF((p: any) => ({ ...p, [k]: value, page: 1 }));

  const Titulos: any = {
    reportante: ['Mis incidencias', 'Reportes que tú registraste y su avance.'],
    tecnico: ['Incidencias asignadas', 'Solo los tickets que tienes asignados.'],
    soporte_ti: ['Todas las incidencias', 'Filtros combinables sobre el campus completo.'],
  };

  const [lt, ls] = soloPendientes
    ? ['Incidencias por autorizar', 'Solicitudes pendientes de aprobación (RF-06).']
    : Titulos[rolesDe(user).find((r) => Titulos[r]) || 'reportante'];

  return (
    <div className="space-y-4">
      <Page t={lt} s={ls} />

      <Err m={e} />

      <Card className="p-4">
        <div className="mb-3 flex gap-3">
          <input
            className={inp}
            aria-label="Buscar por título o descripción"
            value={f.q ?? ''}
            placeholder="Buscar por título o descripción…"
            onChange={(x) => set('q')(x.target.value)}
          />

          {reporta(user) && (
            <button
              className={btn + ' whitespace-nowrap sm:hidden'}
              onClick={() => go({ v: 'nueva' })}
            >
              + Nueva incidencia
            </button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-5">
          <Sel
            l="Categoría"
            o={CATS}
            all="Todas"
            v={f.categoria}
            on={set('categoria')}
          />

          <Sel
            l="Estado"
            o={ESTADOS}
            all="Todos"
            v={f.estado}
            on={set('estado')}
          />

          <Sel
            l="Prioridad"
            o={PRIOS}
            all="Cualquiera"
            v={f.prioridad}
            on={set('prioridad')}
          />

          <Sel
            l="Ubicación"
            o={edificios}
            all="Todo el campus"
            v={f.edificio}
            on={set('edificio')}
          />

          <label className="block">
            <Lbl>Etiqueta</Lbl>

            <input
              className={inp}
              placeholder="WiFi"
              value={f.etiqueta ?? ''}
              onChange={(x) => set('etiqueta')(x.target.value)}
            />
          </label>
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900">
          Cola de incidencias
        </h2>

        <Pill
          t={d.total + ' activas'}
          c="bg-slate-100 text-slate-600"
        />
      </div>

      <Card className="overflow-hidden">
        <Tabla items={d.items} go={go} />

        <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <span>
            Mostrando {d.items.length} de {d.total} documentos
          </span>

          <div className="flex items-center gap-1">
            <button
              className={ghost + ' !px-2.5 !py-1'}
              disabled={f.page <= 1}
              onClick={() =>
                setF({ ...f, page: f.page - 1 })
              }
            >
              ‹
            </button>

            <span className="tabular-nums px-1">
              {f.page} / {d.pages || 1}
            </span>

            <button
              className={ghost + ' !px-2.5 !py-1'}
              disabled={f.page >= d.pages}
              onClick={() =>
                setF({ ...f, page: f.page + 1 })
              }
            >
              ›
            </button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// 7. REGISTRO DE NUEVAS INCIDENCIAS
// ============================================================

function Nueva({ go, user, enAtlas, storage }: any) {
  const edificios = useEdificios();

  const [f, setF] = useState<any>({
    categoria: CATS[0],
    prioridad: 'Media',
    edificio: EDIF[0],
    tags: [],
  });

  const [tag, setTag] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [e, setE] = useState('');
  const [b, setB] = useState(false);
  const errRef = useRef<HTMLDivElement>(null);

  // Un aviso abajo de un formulario largo no se ve si el foco está arriba: se trae a pantalla.
  useEffect(() => {
    if (e) errRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [e]);

  const fields = () => {
    const datos: any = {};

    for (const c of CAMPOS_CAT[f.categoria] || []) {
      let v = (f.cat?.[c.k] || '').toString().trim();
      if (c.k === 'vlan' && v) {
        const digitos = v.replace(/[^\d]/g, '');
        if (digitos) v = digitos;
      }
      if (c.k === 'direccion_ip' && v) {
        v = v.replace(/\.+$/, '').trim();
      }
      if (v) datos[c.k] = v;
    }

    return {
      titulo: f.titulo || '',
      descripcion: f.descripcion || '',
      categoria: f.categoria,
      prioridad: f.prioridad,
      edificio: f.edificio,
      espacio: f.espacio || '',
      etiquetas: JSON.stringify(f.tags),
      datosCategoria: JSON.stringify(datos),
    };
  };

  const faltaCat = (CAMPOS_CAT[f.categoria] || []).some(
    (c: any) => c.req && !(f.cat?.[c.k] || '').toString().trim()
  );

  const draft = async () => {
    if (
      (f.titulo || '').length < 5 ||
      (f.descripcion || '').length < 10
    ) {
      return setE(
        'Completa título (5+) y descripción (10+) antes de guardar el borrador'
      );
    }

    await saveDraft(fields(), files);

    alert(
      'Borrador guardado en este dispositivo. Se enviará automáticamente al recuperar conexión.'
    );

    go({ v: 'lista' });
  };

  const send = async () => {
    setE('');

    if (
      (f.titulo || '').length < 5 ||
      (f.descripcion || '').length < 10
    ) {
      return setE(
        'Revisa el título (mínimo 5 caracteres) y la descripción (mínimo 10).'
      );
    }

    if (faltaCat) {
      return setE(
        'Completa los campos obligatorios de ' + SH[f.categoria]
      );
    }

    if (!navigator.onLine) {
      return draft();
    }

    setB(true);

    try {
      const d = await api('/incidencias', {
        method: 'POST',
        body: toFD(fields(), files),
      });

      go({
        v: 'detalle',
        id: d._id,
        ok:
          `Incidencia ${d.folio} registrada en MongoDB` +
          (d.evidencias?.length
            ? ` con ${d.evidencias.length} archivo(s) en su bucket`
            : d.aviso
              ? '. ' + d.aviso
              : ''),
      });
    } catch (x: any) {
      if (x instanceof TypeError) {
        await draft();
      } else {
        setE(x.message);
      }
    }

    setB(false);
  };

  const add = (l: FileList | null) => {
    const selected = [...(l || [])];

    const ok = selected.filter(cupo);

    if (ok.length < selected.length) {
      setE('Solo imágenes (JPG, PNG, WebP · máx. 10 MB) o documentos (PDF, DOC, DOCX, XLS, XLSX, TXT · máx. 20 MB)');
    }

    setFiles([...files, ...ok].slice(0, 5));
  };

  // Quitar un archivo antes de enviar: todavía no tocó Supabase, así que solo se retira de la
  // selección local. El <input> se remonta con `key` para que vuelva a aceptar el mismo nombre.
  const quita = (i: number) => {
    setFiles(files.filter((_, j) => j !== i));
    setE('');
  };

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <div className="space-y-5 lg:col-span-2">
        <Page
          t="Registrar incidencia"
          s={
            'El ticket recibirá folio automático y se indexará en ' +
            (enAtlas ? 'MongoDB Atlas.' : 'la base de datos conectada.')
          }
        />

        {/* El aviso de validación se muestra junto a los botones de acción: es donde ocurre
            el clic y antes quedaba fuera de la pantalla. */}

        {/* Información general */}

        <Card className="p-5">
          <Head
            n="1"
            t="Información general"
            s="Clasificación operativa y criticidad"
          />

          <label className="block">
            <Lbl>Título conciso del problema</Lbl>

            <input
              className={inp}
              maxLength={80}
              placeholder="Ej. Falla intermitente en switch PoE"
              onChange={(x) =>
                setF({ ...f, titulo: x.target.value })
              }
            />
          </label>

          <p className="mt-4 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500" id="lbl-cat">
            Categoría principal
          </p>

          <div className="grid gap-3 md:grid-cols-3" role="group" aria-labelledby="lbl-cat">
            {CATS.map((c) => (
              <button
                key={c}
                onClick={() =>
                  setF({ ...f, categoria: c })
                }
                className={
                  'rounded-lg border p-3 text-left text-sm transition-colors ' +
                  (f.categoria === c
                    ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')
                }
              >
                <span className="block text-xs font-semibold text-slate-800">
                  {SH[c]}
                </span>

                <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">
                  {c}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
            <p className="mb-1 text-sm font-medium text-slate-800">
              Datos de {SH[f.categoria]}
            </p>

            <p className="mb-3 text-xs text-slate-500">
              Campos obligatorios marcados con *. Lo que no marques es
              opcional.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {(CAMPOS_CAT[f.categoria] || []).map((c: any) => (
                <div key={c.k}>
                  <label
                    className={lbl}
                    htmlFor={'cat-' + c.k}
                  >
                    {c.l}
                    {c.req ? ' *' : ''}
                  </label>

                  {c.opt ? (
                    <select
                      id={'cat-' + c.k}
                      className={inp}
                      value={f.cat?.[c.k] || ''}
                      onChange={(x) =>
                        setF({
                          ...f,
                          cat: {
                            ...(f.cat || {}),
                            [c.k]: x.target.value,
                          },
                        })
                      }
                    >
                      <option value="">Sin dato</option>

                      {c.opt.map((o: string) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={'cat-' + c.k}
                      className={inp}
                      placeholder={c.ph}
                      maxLength={160}
                      aria-required={c.req}
                      value={f.cat?.[c.k] || ''}
                      onChange={(x) =>
                        setF({
                          ...f,
                          cat: {
                            ...(f.cat || {}),
                            [c.k]: x.target.value,
                          },
                        })
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          <p className="mt-4 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Prioridad (SLA operativo)
          </p>

          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {PRIOS.map((p) => (
              <button
                key={p}
                onClick={() =>
                  setF({ ...f, prioridad: p })
                }
                className={
                  'rounded-lg border px-3 py-2 text-left text-sm transition-colors ' +
                  (f.prioridad === p
                    ? 'border-emerald-600 bg-emerald-50/50 ring-1 ring-emerald-600'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50')
                }
              >
                <b className="text-slate-800">{p}</b>

                <span className="mt-0.5 block text-[11px] text-slate-500">
                  SLA {SLA[p]}
                </span>
              </button>
            ))}
          </div>
        </Card>

        {/* Ubicación y reportante */}

        <Card className="p-5">
          <Head
            n="2"
            t="Ubicación y reportante"
            s="Rastreo físico del activo"
          />

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <Lbl>Edificio o zona</Lbl>

              <select
                className={inp}
                value={f.edificio}
                onChange={(x) =>
                  setF({ ...f, edificio: x.target.value })
                }
              >
                {edificios.map((x: string) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <Lbl>Espacio o aula</Lbl>

              <input
                className={inp}
                onChange={(x) =>
                  setF({ ...f, espacio: x.target.value })
                }
              />
            </label>
          </div>

          <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
            <p className="mb-0.5 text-[11px] uppercase tracking-wider text-slate-400">
              Solicitante
            </p>

            <p className="text-slate-700">
              {user.nombre} ·{' '}
              <span className="text-slate-500">
                {user.email}
              </span>
            </p>
          </div>
        </Card>

        {/* Descripción y etiquetas */}

        <Card className="p-5">
          <Head
            n="3"
            t="Descripción y diagnóstico"
            s="Condiciones del fallo o pasos de reproducción"
          />

          <textarea
            className={inp}
            rows={5}
            aria-label="Descripción del problema"
            onChange={(x) =>
              setF({ ...f, descripcion: x.target.value })
            }
          />

          <p className="mt-4 mb-1.5 text-[11px] font-medium uppercase tracking-wider text-slate-500">
            Etiquetas de búsqueda
          </p>

          <div className="mb-2 flex flex-wrap gap-1.5">
            {f.tags.map((t: string) => (
              <button
                key={t}
                onClick={() =>
                  setF({
                    ...f,
                    tags: f.tags.filter(
                      (y: string) => y !== t
                    ),
                  })
                }
                title="Quitar"
              >
                <Tag t={t + ' ×'} />
              </button>
            ))}
          </div>

          <input
            className={inp}
            value={tag}
            aria-label="Etiqueta nueva"
            placeholder="Escribe una etiqueta y pulsa Enter (o separa por comas)…"
            onChange={(x) => setTag(x.target.value)}
            onKeyDown={(x) => {
              if ((x.key === 'Enter' || x.key === ',') && tag.trim()) {
                x.preventDefault();
                const nuevas = tag
                  .split(',')
                  .map((t) => t.trim().replace(/[#.]/g, ''))
                  .filter(Boolean);

                setF({
                  ...f,
                  tags: [
                    ...f.tags,
                    ...nuevas,
                  ],
                });

                setTag('');
              }
            }}
          />
        </Card>

        {/* Evidencias */}

        <Card className="p-5">
          <Head
            n="4"
            t="Evidencias"
            s="Imágenes 10 MB · documentos 20 MB · hasta 5 archivos"
          />

          <label className="block cursor-pointer rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 transition-colors hover:border-emerald-400 hover:text-emerald-700">
            <p className="font-medium">
              Arrastra o selecciona tus archivos
            </p>

            <input
              key={'ev-' + files.length}
              type="file"
              multiple
              hidden
              accept={ACEPTA_EV}
              onChange={(x) => add(x.target.files)}
            />
          </label>

          {/* El servidor dice por qué no puede escribir en Supabase: sin esto el archivo parece
              guardarse y desaparece al recargar el expediente. */}
          {storage && !storage.hay && files.length > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              El servidor no puede guardar archivos: {storage.motivo} Se crearán el expediente y su
              folio, pero las evidencias se descartarán.
            </p>
          )}

          {files.map((x, i) => (
            <p
              key={`${x.name}-${i}`}
              className="mt-2 flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600"
            >
              <span className="truncate">{x.name}</span>

              <span className="flex shrink-0 items-center gap-2">
                <span className="text-[10px] uppercase tracking-wide text-slate-400">
                  {destino(x.type)} · {(x.size / 1e6).toFixed(1)} MB
                </span>

                <button
                  type="button"
                  className="rounded-md px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                  onClick={() => quita(i)}
                  aria-label={`Quitar ${x.name} de las evidencias`}
                  title="Quitar este archivo"
                >
                  ✕
                </button>
              </span>
            </p>
          ))}
        </Card>

        {/* Acciones: el aviso de validación va aquí, junto al botón que lo provoca */}

        <div className="space-y-3">
          <div ref={errRef}>
            <Err m={e} />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <button
              className="text-sm text-slate-500 hover:text-slate-800"
              onClick={() => go({ v: 'lista' })}
            >
              Cancelar
            </button>

            <button
              className={ghost}
              onClick={draft}
            >
              Guardar borrador (offline)
            </button>

            <button
              className={btn}
              disabled={b}
              onClick={send}
            >
              {b ? 'Guardando…' : 'Guardar y generar folio'}
            </button>
          </div>
        </div>
      </div>

      {/* Vista previa */}

      <div className="hidden lg:block">
        <Card className="sticky top-20 p-5">
          <div className="mb-3 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-slate-400">
            <span>Vista previa</span>
            <Pill t="Borrador" />
          </div>

          <div className="rounded-lg border border-slate-200 p-4">
            <div className="flex justify-between">
              <span className="font-mono text-xs text-slate-400">
                #PENDIENTE
              </span>

              <Pill
                t={f.prioridad}
                c={PC[f.prioridad]}
              />
            </div>

            <p className="mt-2 text-sm font-semibold text-slate-900">
              {f.titulo || 'Título del problema…'}
            </p>

            <p className="mt-2 text-xs text-slate-500">
              {f.edificio}
              {f.espacio && ' · ' + f.espacio}
            </p>

            <p className="text-xs text-slate-500">
              {user.nombre}
            </p>

            <p className="text-xs text-slate-500">
              SLA estimado: {SLA[f.prioridad]}
            </p>

            <p className="text-xs text-slate-500">
              {files.length} evidencias
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// 8. DETALLE DE INCIDENCIA E INTERVENCIONES
// ============================================================

function Detalle({ id, user, go, ok }: any) {
  const [d, setD] = useState<any>(null);
  const [tec, setTec] = useState<any[]>([]);
  const [e, setE] = useState('');
  const [okx, setOkx] = useState(ok || '');
  const [ne, setNe] = useState('');
  const [ce, setCe] = useState('');
  const [mot, setMot] = useState('');
  const [nf, setNf] = useState<File[]>([]);
  const [sub, setSub] = useState(false);

  const [iv, setIv] = useState({
    comentario: '',
    horas: '1',
  });

  const staff = interviene(user);
  const admin = gestiona(user);

  const load = () =>
    api('/incidencias/' + id)
      .then(setD)
      .catch((x) => setE(x.message));

  useEffect(() => {
    load();

    if (gestiona(user)) {
      api('/tecnicos')
        .then(setTec)
        .catch((x) => setE(x.message));
    }
  }, [id]);

  const act =
    (fn: () => Promise<any>) => async () => {
      setE('');

      try {
        await fn();
        await load();
      } catch (x: any) {
        setE(x.message);
      }
    };

  const autorizar = (accion: string) =>
    act(async () => {
      if (
        accion === 'rechazar' &&
        !confirm(
          'Rechazar esta solicitud la cerrará de forma definitiva. ¿Continuar?'
        )
      ) {
        return;
      }

      await api(`/incidencias/${id}/autorizacion`, {
        method: 'PATCH',
        body: { accion, motivo: mot || undefined },
      });

      setMot('');
    })();

  const subirEvidencias = () =>
    act(async () => {
      const fd = new FormData();

      for (const f of nf) fd.append('evidencias', f);

      setSub(true);

      try {
        const r: any = await api(`/incidencias/${id}/evidencias`, {
          method: 'POST',
          body: fd,
        });

        const cubos = [
          ...new Set(
            (r.evidencias || []).slice(-nf.length).map((x: any) => x.bucket)
          ),
        ];

        setOkx(
          `${nf.length} archivo(s) guardado(s)${cubos.length ? ' en ' + cubos.join(' y ') : ''}`
        );

        setNf([]);
      } finally {
        setSub(false);
      }
    })();

  if (!d) {
    return (
      <p className="text-sm text-slate-400">
        {e || 'Cargando…'}
      </p>
    );
  }

  const hrs = (d.historial || []).reduce(
    (a: number, h: any) => a + (h.horas || 0),
    0
  );

  // Espejo del servidor: puede adjuntar quien tiene el rol en el conjunto y le corresponde
  // el expediente (Soporte TI ve todos, el técnico los asignados, el reportante los propios).
  const puedeAdjuntar =
    d.estado !== 'Cerrada' &&
    (gestiona(user) ||
      (tiene(user, 'tecnico') &&
        String(d.tecnico?.id || '') === String(user.id)) ||
      (reporta(user) &&
        String(d.reportante?.id || '') === String(user.id)));

  const opcionesEstado = (TRANSICIONES[d.estado] || []).filter(
    (x) => x !== 'Cerrada' || admin
  );

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400">
        <button
          className="hover:text-slate-600"
          onClick={() => go({ v: 'lista' })}
        >
          Incidencias
        </button>{' '}
        / {SH[d.categoria]} /{' '}
        <b className="font-mono text-slate-600">
          {d.folio}
        </b>
      </p>

      <Err m={e} />

      <Ok m={okx} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Pill
              t={d.folio}
              c="bg-emerald-50 text-emerald-700 font-mono"
            />

            <Pill
              t={d.prioridad}
              c={PC[d.prioridad]}
            />

            <span className="text-xs text-slate-400">
              Registrado{' '}
              {new Date(d.createdAt).toLocaleString()}
            </span>
          </div>

          <h1 className="font-heading text-2xl font-extrabold tracking-tight text-slate-900">
            {d.titulo}
          </h1>
        </div>

        <div className="text-right">
          <button
            className={ghost + ' mb-2 print:hidden!'}
            onClick={() => window.print()}
          >
            Imprimir reporte
          </button>

          <Lbl>Estado del ciclo de vida</Lbl>

          <Pill
            t={d.estado}
            c={EC[d.estado]}
          />

          {staff && opcionesEstado.length > 0 && (
            <div className="mt-3 space-y-2 text-left">
              <select
                className={inp + ' max-w-48'}
                aria-label="Nuevo estado"
                value={ne}
                onChange={(x) => setNe(x.target.value)}
              >
                <option value="">Cambiar a…</option>

                {opcionesEstado.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>

              {ne && (
                <>
                  <input
                    className={inp + ' max-w-48'}
                    aria-label="Comentario para la bitácora"
                    placeholder="Comentario obligatorio"
                    value={ce}
                    onChange={(x) => setCe(x.target.value)}
                  />

                  <button
                    className={btn + ' w-full max-w-48'}
                    disabled={!ce.trim()}
                    title={ce.trim() ? '' : 'Todo cambio de estado requiere un comentario para la bitácora'}
                    onClick={() =>
                      act(async () => {
                        await api(`/incidencias/${id}/estado`, {
                          method: 'PATCH',
                          body: { estado: ne, comentario: ce.trim() },
                        });
                        setNe('');
                        setCe('');
                      })()
                    }
                  >
                    Aplicar cambio
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          {/* Diagnóstico */}

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Diagnóstico y reportante
              </h2>

              <Pill
                t={SH[d.categoria]}
                c="bg-slate-100 text-slate-600"
              />
            </div>

            <div className="mb-4 rounded-lg bg-slate-50 px-3 py-2.5 text-sm">
              <b className="text-slate-800">
                {d.reportante?.nombre}
              </b>

              <p className="text-xs text-slate-500">
                {d.reportante?.email}
              </p>
            </div>

            <Lbl>Detalle del evento</Lbl>

            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
              {d.descripcion}
            </p>

            {Object.keys(d.datosCategoria || {}).length > 0 && (
              <div className="mt-4">
                <Lbl>Datos de {SH[d.categoria]}</Lbl>

                <dl className="grid gap-2 sm:grid-cols-2">
                  {(CAMPOS_CAT[d.categoria] || [])
                    .filter((c: any) => d.datosCategoria[c.k])
                    .map((c: any) => (
                      <div
                        key={c.k}
                        className="rounded-lg bg-slate-50 px-3 py-2"
                      >
                        <dt className="text-[11px] uppercase tracking-wider text-slate-500">
                          {c.l}
                        </dt>

                        <dd className="text-sm text-slate-800">
                          {String(d.datosCategoria[c.k])}
                        </dd>
                      </div>
                    ))}
                </dl>
              </div>
            )}
          </Card>

          {/* Evidencias adjuntas */}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Evidencias adjuntas
            </h2>

            <div className="grid gap-3 md:grid-cols-2">
              {(d.evidencias || []).map((x: any) => (
                <div
                  key={x.path}
                  className="overflow-hidden rounded-lg border border-slate-200"
                >
                  {x.tipo.startsWith('image') ? (
                    <a
                      href={x.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={x.url}
                        alt={x.nombre}
                        className="h-40 w-full object-cover transition-opacity hover:opacity-90"
                      />
                    </a>
                  ) : (
                    <a
                      className="block p-4 text-sm text-emerald-700 hover:underline"
                      href={x.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {x.nombre}
                    </a>
                  )}

                  <p className="truncate border-t border-slate-100 px-2 py-1.5 text-[11px] text-slate-500">
                    {x.nombre} · {(x.size / 1e6).toFixed(1)} MB
                    {x.bucket && (
                      <span className="ml-2 uppercase tracking-wide text-[10px] text-slate-400">
                        {x.bucket}
                      </span>
                    )}
                  </p>
                </div>
              ))}

              {!d.evidencias?.length && (
                <p className="text-sm text-slate-400">
                  Sin evidencias
                </p>
              )}
            </div>

            {puedeAdjuntar && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <label className={lbl} htmlFor="ev-nuevas">
                  Añadir evidencia (imágenes 10 MB · documentos 20 MB · hasta 5
                  archivos)
                </label>

                <input
                  key={'ev-nuevas-' + nf.length}
                  id="ev-nuevas"
                  type="file"
                  multiple
                  accept={ACEPTA_EV}
                  className={inp}
                  onChange={(x) => {
                    const sel = [...(x.target.files || [])];

                    const ok = sel.filter(cupo);

                    if (ok.length < sel.length) {
                      setE(
                        'Solo imágenes (10 MB) o documentos (20 MB): JPG, PNG, WebP, PDF, DOC, DOCX, XLS, XLSX o TXT'
                      );
                    }

                    setNf([...nf, ...ok].slice(0, 5));
                  }}
                />

                {!!nf.length && (
                  <div className="mt-2 space-y-2">
                    <ul className="space-y-1">
                      {nf.map((f, i) => (
                        <li
                          key={f.name + i}
                          className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-600"
                        >
                          <span className="truncate">{f.name}</span>

                          <span className="flex shrink-0 items-center gap-2">
                            <span className="text-[10px] uppercase tracking-wide text-slate-400">
                              {(f.size / 1e6).toFixed(1)} MB
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                setNf(nf.filter((_, j) => j !== i))
                              }
                              aria-label={`Quitar ${f.name} de la subida`}
                              title="Quitar este archivo"
                              className="rounded-md px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                            >
                              ✕
                            </button>
                          </span>
                        </li>
                      ))}
                    </ul>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className={btn}
                        disabled={sub}
                        onClick={subirEvidencias}
                      >
                        {sub
                          ? 'Subiendo…'
                          : 'Subir ' + nf.length + ' archivo(s)'}
                      </button>

                      <button
                        className={ghost}
                        onClick={() => setNf([])}
                      >
                        Descartar todo
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* Intervenciones técnicas */}

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Intervenciones técnicas
              </h2>

              <Pill
                t={'Total: ' + hrs.toFixed(1) + ' h'}
                c="bg-slate-100 text-slate-600"
              />
            </div>

            {staff && (
              <div className="mb-4 rounded-lg bg-slate-50 p-4 print:hidden!">
                <div className="grid gap-3 md:grid-cols-4">
                  <label className="block">
                    <Lbl>Horas invertidas</Lbl>

                    <input
                      className={inp}
                      type="number"
                      min="0"
                      step="0.5"
                      value={iv.horas}
                      onChange={(x) =>
                        setIv({
                          ...iv,
                          horas: x.target.value,
                        })
                      }
                    />
                  </label>

                  <label className="block md:col-span-3">
                    <Lbl>Notas del técnico</Lbl>

                    <textarea
                      className={inp}
                      rows={2}
                      value={iv.comentario}
                      onChange={(x) =>
                        setIv({
                          ...iv,
                          comentario: x.target.value,
                        })
                      }
                    />
                  </label>
                </div>

                <button
                  className={btn + ' mt-3'}
                  onClick={act(() =>
                    api(`/incidencias/${id}/intervenciones`, {
                      method: 'POST',
                      body: iv,
                    })
                  )}
                >
                  Registrar en historial
                </button>
              </div>
            )}

            <Lbl>Historial de acciones</Lbl>

            {[...(d.historial || [])]
              .reverse()
              .map((h: any, i: number) => (
                <div
                  key={i}
                  className="relative mb-4 border-l border-slate-200 pb-0 pl-4 text-sm"
                >
                  <span className="absolute -left-[3px] top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-600" />

                  <div className="flex flex-wrap items-center gap-2">
                    <b className="text-slate-800">
                      {h.autor}
                    </b>

                    {h.horas > 0 && (
                      <Pill
                        t={'+' + h.horas + ' h'}
                        c="bg-slate-100 text-slate-600"
                      />
                    )}

                    <Pill
                      t={h.tipo}
                      c="bg-emerald-50 text-emerald-700"
                    />

                    <span className="ml-auto text-xs text-slate-400">
                      {new Date(h.fecha).toLocaleString()}
                    </span>
                  </div>

                  {h.estadoNuevo && (
                    <p className="text-xs text-slate-500">
                      {h.estadoAnterior || '—'} → {h.estadoNuevo}
                    </p>
                  )}

                  <p className="text-slate-600">
                    {h.comentario}
                  </p>
                </div>
              ))}
          </Card>
        </div>

        {/* Atributos operativos y utilidades */}

        <div className="space-y-5">
          {d.autorizacion && (
            <Card className="p-5">
              <h2 className="mb-3 text-sm font-semibold text-slate-900">
                Autorización de la solicitud
              </h2>

              <Pill
                t={
                  d.autorizacion.estado === 'aprobada'
                    ? 'Aprobada'
                    : d.autorizacion.estado === 'rechazada'
                      ? 'Rechazada'
                      : 'Pendiente de revisión'
                }
                c={
                  d.autorizacion.estado === 'aprobada'
                    ? 'bg-emerald-50 text-emerald-700'
                    : d.autorizacion.estado === 'rechazada'
                      ? 'bg-red-50 text-red-700'
                      : 'bg-amber-50 text-amber-700'
                }
              />

              {d.autorizacion.motivo && (
                <p className="mt-2 text-xs text-slate-600">
                  Motivo: {d.autorizacion.motivo}
                </p>
              )}

              {admin && d.autorizacion.estado === 'pendiente' && (
                <div className="mt-3 space-y-2">
                  <input
                    className={inp}
                    aria-label="Motivo del rechazo"
                    placeholder="Motivo del rechazo (obligatorio)"
                    value={mot}
                    onChange={(x) => setMot(x.target.value)}
                  />

                  <div className="flex gap-2">
                    <button
                      className={btn + ' flex-1'}
                      onClick={() =>
                        autorizar('aprobar')
                      }
                    >
                      Autorizar
                    </button>

                    <button
                      className={ghost + ' flex-1'}
                      onClick={() => {
                        if (!mot.trim())
                          return setE(
                            'Escribe el motivo del rechazo antes de rechazar'
                          );
                        autorizar('rechazar');
                      }}
                    >
                      Rechazar
                    </button>
                  </div>
                </div>
              )}

              {d.autorizacion.estado === 'pendiente' && !admin && (
                <p className="mt-2 text-xs text-slate-500">
                  Soporte TI debe aprobarla antes de que un técnico
                  pueda atenderla.
                </p>
              )}
            </Card>
          )}

          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold text-slate-900">
              Atributos operativos
            </h2>

            <Lbl>Ubicación</Lbl>

            <p className="mb-3 text-sm text-slate-700">
              {d.edificio} · {d.espacio}
            </p>

            <Lbl>Técnico titular</Lbl>

            <p className="mb-3 text-sm text-slate-700">
              {d.tecnico?.nombre || 'Sin asignar'}
            </p>

            {admin && (
              <select
                className={inp}
                aria-label="Asignar técnico"
                defaultValue=""
                onChange={(x) =>
                  act(() =>
                    api(`/incidencias/${id}/asignar`, {
                      method: 'PATCH',
                      body: {
                        tecnicoId: x.target.value,
                      },
                    })
                  )()
                }
              >
                <option value="" disabled>
                  {d.autorizacion?.estado === 'aprobada'
                    ? 'Reasignar técnico…'
                    : 'Asignar (requiere autorización)…'}
                </option>

                {tec.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nombre}
                  </option>
                ))}
              </select>
            )}

            <div className="mt-3 flex flex-wrap gap-1">
              {(d.etiquetas || []).map((t: string) => (
                <Tag key={t} t={t} />
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <h3 className="mb-1 text-sm font-semibold text-slate-900">
              Regla de retención TTL
            </h3>

            <p className="text-xs text-slate-500">
              Al resolverse, esta incidencia se depurará
              automáticamente a los 60 días.
            </p>
          </Card>

          <MapaCard d={d} />

          <BsonCard d={d} />
        </div>
      </div>
    </div>
  );
}

// ============================================================
// 9. MAPA DEL CAMPUS
// ============================================================

const COORD: any = {
  'Edificio A': [17.8190, -97.7795],
  'Edificio B': [17.8185, -97.7780],
  'Edificio C': [17.8182, -97.7788],
  'Edificio D': [17.8176, -97.7792],
  Biblioteca: [17.8188, -97.7787],
  Rectoría: [17.8193, -97.7783],
};

function MapaCard({ d }: any) {
  const [la, lo] = COORD[d.edificio] || [
    17.8182,
    -97.7788,
  ];

  const b = 0.0015;

  return (
    <Card className="overflow-hidden">
      <div className="p-5 pb-3">
        <h3 className="text-sm font-semibold text-slate-900">
          Ubicación en el campus
        </h3>

        <p className="mt-0.5 font-mono text-[11px] text-slate-400">
          {la}° N, {Math.abs(lo)}° W
        </p>
      </div>

      <iframe
        title="mapa"
        className="h-44 w-full border-0"
        src={`https://www.openstreetmap.org/export/embed.html?bbox=${lo - b},${la - b},${lo + b},${la + b}&layer=mapnik&marker=${la},${lo}`}
      />

      <p className="border-t border-slate-100 px-5 py-2 text-xs text-slate-500">
        {d.edificio} · {d.espacio}
      </p>
    </Card>
  );
}

// ============================================================
// 10. CONVERSIÓN DE DATOS A REPRESENTACIÓN EXTENDED JSON
// ============================================================

const ej = (o: any, k = ''): any =>
  Array.isArray(o)
    ? o.map((x) => ej(x))
    : o && typeof o === 'object'
      ? Object.fromEntries(
          Object.entries(o).map(([k2, v]) => [
            k2,
            ej(v, k2),
          ])
        )
      : typeof o === 'string' &&
          /^[0-9a-f]{24}$/.test(o) &&
          (k === '_id' || k === 'id')
        ? { $oid: o }
        : typeof o === 'string' &&
            /^\d{4}-\d\d-\d\dT/.test(o)
          ? { $date: o }
          : o;

// ============================================================
// 11. VISOR DEL DOCUMENTO BSON
// ============================================================

function BsonCard({ d }: any) {
  const [open, setOpen] = useState(false);

  const txt = JSON.stringify(
    ej({
      ...d,
      evidencias: (d.evidencias || []).map(
        ({ url, ...r }: any) => r
      ),
    }),
    null,
    2
  );

  return (
    <Card className="overflow-hidden bg-slate-900 print:hidden!">
      <div className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm font-semibold text-slate-100">
            Documento BSON
          </p>

          <p className="font-mono text-[11px] text-slate-400">
            colección: incidencias
          </p>
        </div>

        <div className="flex gap-2">
          <button
            className="rounded-md bg-slate-800 px-2 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700"
            onClick={() =>
              navigator.clipboard.writeText(txt)
            }
          >
            Copiar
          </button>

          <button
            className="px-1 text-xs text-slate-400 hover:text-slate-200"
            onClick={() => setOpen(!open)}
          >
            {open ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {open && (
        <pre className="max-h-96 overflow-auto border-t border-slate-800 px-5 py-3 font-mono text-[11px] leading-relaxed text-emerald-200/90">
          {txt}
        </pre>
      )}
    </Card>
  );
}

// ============================================================
// 12. ESTADÍSTICAS Y MÉTRICAS
// ============================================================

function Stats({ user }: any) {
  const [s, setS] = useState<any>(null);
  const [e, setE] = useState('');
  const [xf, setXf] = useState<any>({});
  const [bx, setBx] = useState(false);

  const edificios = useEdificios();

  useEffect(() => {
    api('/stats')
      .then(setS)
      .catch((x) => setE(x.message));
  }, []);

  const Bars = ({ rows, fmt }: any) => {
    const m = Math.max(
      1,
      ...rows.map((r: any) => r.v)
    );

    return (
      <>
        {rows.map((r: any) => (
          <div key={r.l} className="mb-3">
            <div className="flex justify-between text-xs">
              <span className="text-slate-600">
                {r.l || '—'}
              </span>

              <b className="tabular-nums text-slate-800">
                {fmt ? fmt(r.v) : r.v}
              </b>
            </div>

            <div className="mt-1 h-1 rounded-full bg-slate-100">
              <div
                className="h-1 rounded-full bg-emerald-600"
                style={{
                  width: (r.v / m) * 100 + '%',
                }}
              />
            </div>
          </div>
        ))}

        {!rows.length && (
          <p className="text-xs text-slate-400">
            Sin datos todavía
          </p>
        )}
      </>
    );
  };

  const m = (
    a: any[] = [],
    f = (x: any) => x.n
  ) =>
    a.map((x) => ({
      l: x._id,
      v: f(x),
    }));

  const exportar = async () => {
    try {
      const d = await api('/incidencias/export');

      const a = document.createElement('a');

      a.href = URL.createObjectURL(
        new Blob(
          [JSON.stringify(d, null, 2)],
          { type: 'application/json' }
        )
      );

      a.download = 'incidencias.json';
      a.click();

      URL.revokeObjectURL(a.href);
    } catch (x: any) {
      setE(x.message);
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <Page
          t="Estadísticas y métricas"
          s="Tiempos de resolución, etiquetas frecuentes y carga operativa."
        />

        <Card className="flex flex-wrap items-end gap-2 p-3">
          <label className="block">
            <Lbl>Desde</Lbl>

            <input
              type="date"
              className={inp}
              aria-label="Fecha desde"
              value={xf.desde ?? ''}
              onChange={(x) =>
                setXf({
                  ...xf,
                  desde: x.target.value,
                })
              }
            />
          </label>

          <label className="block">
            <Lbl>Hasta</Lbl>

            <input
              type="date"
              className={inp}
              aria-label="Fecha hasta"
              value={xf.hasta ?? ''}
              onChange={(x) =>
                setXf({
                  ...xf,
                  hasta: x.target.value,
                })
              }
            />
          </label>

          <Sel
            l="Estado"
            o={ESTADOS}
            all="Todos"
            v={xf.estado}
            on={(x: string) => setXf({ ...xf, estado: x })}
          />

          <Sel
            l="Edificio"
            o={edificios}
            all="Todo el campus"
            v={xf.edificio}
            on={(x: string) => setXf({ ...xf, edificio: x })}
          />

          {gestiona(user) && (
            <>
              <button
                className={btn}
                disabled={bx}
                onClick={async () => {
                  setBx(true);
                  setE('');

                  try {
                    await excel(xf);
                  } catch (x: any) {
                    setE(x.message);
                  } finally {
                    setBx(false);
                  }
                }}
              >
                {bx ? 'Generando…' : 'Exportar Excel'}
              </button>

              <button
                className={ghost}
                onClick={exportar}
              >
                JSON
              </button>
            </>
          )}
        </Card>
      </div>

      <Err m={e} />

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            Resolución promedio por edificio
          </h3>

          <Bars
            rows={m(
              s?.tiempoPorEdificio,
              (x: any) => x.horasPromedio
            )}
            fmt={(v: number) => v.toFixed(1) + ' h'}
          />
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">
            10 etiquetas más frecuentes
          </h3>

          {(s?.topEtiquetas || []).map(
            (x: any, i: number) => (
              <div
                key={x._id}
                className="flex items-center gap-3 border-b border-slate-100 py-2 text-sm last:border-0"
              >
                <span className="w-4 text-xs tabular-nums text-slate-400">
                  {i + 1}
                </span>

                <Tag t={x._id} />

                <b className="ml-auto tabular-nums text-slate-700">
                  {x.n}
                </b>
              </div>
            )
          )}

          {!s?.topEtiquetas?.length && (
            <p className="text-xs text-slate-400">
              Sin datos todavía
            </p>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            Carga activa por edificio
          </h3>

          <Bars rows={m(s?.carga)} />
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            Por estado
          </h3>

          <Bars rows={m(s?.porEstado)} />
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            Por categoría
          </h3>

          <Bars
            rows={m(s?.porCategoria).map((r: any) => ({
              ...r,
              l: SH[r.l] || r.l,
            }))}
          />
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 text-sm font-semibold text-slate-900">
            Por prioridad
          </h3>

          <Bars rows={m(s?.porPrioridad)} />
        </Card>
      </div>
    </div>
  );
}

// ============================================================
// 13. BASE DE CONOCIMIENTO
// ============================================================

function KB({ user }: any) {
  const [l, setL] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [o, setO] = useState('');
  const [f, setF] = useState<any>({
    titulo: '',
    contenido: '',
  });

  const [e, setE] = useState('');
  const staff = interviene(user);

  const load = () =>
    api('/kb?q=' + encodeURIComponent(q))
      .then(setL)
      .catch((x) => setE(x.message));

  useEffect(() => {
    load();
  }, [q]);

  const add = async () => {
    setE('');

    try {
      await api('/kb', {
        method: 'POST',
        body: f,
      });

      setF({
        titulo: '',
        contenido: '',
      });

      load();
    } catch (x: any) {
      setE(x.message);
    }
  };

  const del = async (id: string) => {
    if (confirm('¿Eliminar artículo?')) {
      try {
        await api('/kb/' + id, {
          method: 'DELETE',
        });

        load();
      } catch (x: any) {
        setE(x.message);
      }
    }
  };

  return (
    <div className="space-y-4">
      <Page
        t="Base de conocimiento"
        s="Soluciones frecuentes y guías de la mesa de servicios."
      />

      <Err m={e} />

      <input
        className={inp}
        aria-label="Buscar en la base de conocimiento"
        placeholder="Buscar en la base de conocimiento…"
        value={q}
        onChange={(x) => setQ(x.target.value)}
      />

      {l.map((a) => (
        <Card key={a._id} className="px-5">
          <button
            className="flex w-full items-center justify-between py-4 text-left text-sm font-medium text-slate-800"
            onClick={() =>
              setO(o === a._id ? '' : a._id)
            }
          >
            {a.titulo}

            <span className="text-slate-400">
              {o === a._id ? '−' : '+'}
            </span>
          </button>

          {o === a._id && (
            <div className="border-t border-slate-100 py-4">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                {a.contenido}
              </p>

              <p className="mt-2 text-xs text-slate-400">
                {a.autor}
              </p>

              {gestiona(user) && (
                <button
                  className="mt-2 text-xs font-medium text-red-600 hover:underline"
                  onClick={() => del(a._id)}
                >
                  Eliminar
                </button>
              )}
            </div>
          )}
        </Card>
      ))}

      {!l.length && (
        <p className="text-sm text-slate-400">
          Sin artículos.
        </p>
      )}

      {staff && (
        <Card className="space-y-3 p-5">
          <h3 className="text-sm font-semibold text-slate-900">
            Nuevo artículo
          </h3>

          <input
            className={inp}
            aria-label="Título del artículo"
            placeholder="Título"
            value={f.titulo}
            onChange={(x) =>
              setF({
                ...f,
                titulo: x.target.value,
              })
            }
          />

          <textarea
            className={inp}
            rows={4}
            aria-label="Contenido del artículo"
            placeholder="Contenido"
            value={f.contenido}
            onChange={(x) =>
              setF({
                ...f,
                contenido: x.target.value,
              })
            }
          />

          <button
            className={btn}
            onClick={add}
          >
            Publicar
          </button>
        </Card>
      )}
    </div>
  );
}

// ============================================================
// 14. ADMINISTRACIÓN DE USUARIOS
function Usuarios({ user }: any) {
  const [m, setM] = useState('');
  const [ok, setOk] = useState('');
  const [lista, setLista] = useState<any[]>([]);
  const [carg, setCarg] = useState(true);
  const [q, setQ] = useState('');
  const [rolF, setRolF] = useState('');
  const [pg, setPg] = useState(1);
  const [men, setMen] = useState<any>(null);
  const [cambio, setCambio] = useState<any>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [borrar, setBorrar] = useState<any>(null);
  const [elim, setElim] = useState(false);
  const cancelar = useRef<any>(null);
  const enfoque = useRef<any>(null);

  const POR = 8;

  const load = () => {
    setCarg(true);

    return api('/users')
      .then(setLista)
      .catch((x) => setM(x.message))
      .finally(() => setCarg(false));
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!men) return;

    const cierra = (e: any) => {
      if (!e.target.closest('[data-menu]')) setMen(null);
    };

    // Un scroll o resize dejaría el menú flotando lejos de su botón
    const cae = () => setMen(null);

    document.addEventListener('mousedown', cierra);
    window.addEventListener('scroll', cae, true);
    window.addEventListener('resize', cae);

    const esc = (e: any) => e.key === 'Escape' && setMen(null);
    document.addEventListener('keydown', esc);

    return () => {
      document.removeEventListener('mousedown', cierra);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', cae, true);
      window.removeEventListener('resize', cae);
    };
  }, [men]);

  useEffect(() => {
    if (!borrar) return;

    cancelar.current?.focus();

    const esc = (e: any) => e.key === 'Escape' && setBorrar(null);
    document.addEventListener('keydown', esc);

    return () => document.removeEventListener('keydown', esc);
  }, [borrar]);

  useEffect(() => {
    if (!cambio) return;

    enfoque.current?.focus();

    const esc = (e: any) => e.key === 'Escape' && setCambio(null);
    document.addEventListener('keydown', esc);

    return () => document.removeEventListener('keydown', esc);
  }, [cambio]);

  const BADGE: any = {
    reportante: 'bg-slate-100 text-slate-700',
    tecnico: 'bg-indigo-50 text-indigo-700',
    soporte_ti: 'bg-red-50 text-red-700',
    directivo: 'bg-sky-50 text-sky-700',
  };

  const seek = q.trim().toLowerCase();

  const fila = (u: any) =>
    `${u.nombre} ${u.email}`.toLowerCase().includes(seek);

  const filtrados = lista.filter((u) => fila(u) && (!rolF || rolesDe(u).includes(rolF)));
  const pag = Math.max(1, Math.ceil(filtrados.length / POR));
  const ver = Math.min(pg, pag);
  const visibles = filtrados.slice((ver - 1) * POR, ver * POR);

  const setPag = (n: number) => {
    setPg(Math.min(Math.max(1, n), pag));
    setMen(null);
  };

  const esYo = (u: any) => String(u.id) === String(user?.id);

  // El menú de los tres puntos se dibuja sobre el viewport: dentro de la tabla
  // el overflow de la card y la transformación del hover lo recortaban.
  const ANCHO_MEN = 190;
  // Tu cuenta solo ofrece "Asignar roles": la baja y el cambio de rol propio los hace otra cuenta.
  const altoMenu = (u: any) => (esYo(u) ? 40 : 78);

  const abreMen = (u: any, e: any) => {
    if (men?.u?.id === u.id) return setMen(null);

    const r = e.currentTarget.getBoundingClientRect();
    const alto = altoMenu(u);
    const cabeAbajo = r.bottom + 6 + alto < window.innerHeight;

    setMen({
      u,
      top: cabeAbajo ? r.bottom + 6 : Math.max(8, r.top - 6 - alto),
      left: Math.min(Math.max(8, r.right - ANCHO_MEN), window.innerWidth - ANCHO_MEN - 8),
    });
  };

  const aplicarRoles = async () => {
    setM('');
    setOk('');

    try {
      const r: any = await api(`/users/${cambio.id}/roles`, {
        method: 'PUT',
        body: { roles: sel },
      });
      setOk(
        `Roles de ${cambio.nombre}: ${(r.roles || []).map((x: string) => ROL_LABEL[x] || x).join(', ')}`
      );
      setCambio(null);
      // Si el cambio se aplicó sobre la cuenta propia, la navegación debe actualizarse ya.
      window.dispatchEvent(new Event('sesion-cambiada'));
      await load();
    } catch (x: any) {
      setM(x.message);
      await load();
    }
  };

  const confirmarBaja = async () => {
    setElim(true);
    setM('');

    try {
      await api(`/users/${borrar.id}`, { method: 'DELETE' });
      setOk(`${borrar.nombre} fue eliminado`);
      setBorrar(null);
      await load();
    } catch (x: any) {
      setM(x.message);
    } finally {
      setElim(false);
    }
  };

  return (
    <div className="space-y-5">
      <Page
        t="Gestión de usuarios"
        s={
          carg
            ? 'Cargando perfiles…'
            : `${lista.length} perfiles registrados · ${filtrados.length} visibles con el filtro actual`
        }
      />

      <Err m={m} />

      {ok && (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {ok}
        </p>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-900">
              Cuentas registradas
            </h2>

            {carg && (
              <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                <span
                  className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-emerald-600"
                  aria-hidden="true"
                />
                Obteniendo perfiles…
              </p>
            )}
          </div>

          <input
            className={inp + ' max-w-52'}
            type="search"
            placeholder="Nombre o correo…"
            aria-label="Buscar usuarios por nombre o correo"
            value={q}
            onChange={(x) => {
              setQ(x.target.value);
              setPg(1);
            }}
          />

          <select
            className={inp + ' max-w-40'}
            aria-label="Filtrar por rol"
            value={rolF}
            onChange={(x) => {
              setRolF(x.target.value);
              setPg(1);
            }}
          >
            <option value="">Todos los roles</option>

            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROL_LABEL[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-2.5 font-medium">Usuario</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Email</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Rol</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Registro</th>
                <th scope="col" className="px-3 py-2.5 font-medium">Último acceso</th>
                <th scope="col" className="px-3 py-2.5 text-right font-medium">Acciones</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {carg &&
                [0, 1, 2, 3].map((n) => (
                  <tr key={n}>
                    {[0, 1, 2, 3, 4, 5].map((c) => (
                      <td key={c} className="px-4 py-3">
                        <span
                          className="block h-3 animate-pulse rounded bg-slate-100"
                          aria-hidden="true"
                        />
                      </td>
                    ))}
                  </tr>
                ))}

              {!carg &&
                visibles.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/70">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar id={u.id} nombre={u.nombre} />

                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{u.nombre}</p>

                          <p className="font-mono text-[11px] text-slate-400">
                            {String(u.id).slice(-6).toUpperCase()}
                          </p>
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3 text-xs text-slate-600">
                      {u.email}
                    </td>

                    <td className="px-3 py-3">
                      <span className="flex flex-wrap gap-1">
                        {rolesDe(u).map((r) => (
                          <span
                            key={r}
                            title={ROL_DESC[r]}
                            className={
                              'inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ' +
                              (BADGE[r] || 'bg-slate-100 text-slate-700')
                            }
                          >
                            {ROL_LABEL[r] || r}
                            {r === u.rol && rolesDe(u).length > 1 ? ' ·' : ''}
                          </span>
                        ))}
                      </span>
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-500">
                      {fcha(u.creadoEn, true)}
                    </td>

                    <td className="px-3 py-3 whitespace-nowrap text-xs text-slate-500">
                      {fcha(u.ultimoAcceso)}
                    </td>

                    <td className="px-3 py-3 text-right" data-menu>
                      <button
                        className={ghost + ' px-2 py-1'}
                        aria-label={`Acciones de ${u.nombre}`}
                        aria-haspopup="menu"
                        aria-expanded={men?.u?.id === u.id}
                        onClick={(e) => abreMen(u, e)}
                      >
                        ⋯
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {!carg && !visibles.length && (
          <p className="px-5 py-6 text-xs text-slate-400">
            {lista.length
              ? 'Ningún perfil coincide con la búsqueda o el filtro.'
              : 'Sin usuarios registrados.'}
          </p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-3">
          <p className="text-xs text-slate-500">
            Página {ver} de {pag} · {filtrados.length} resultado(s)
          </p>

          <div className="flex gap-2">
            <button
              className={ghost + ' px-3 py-1 text-xs'}
              onClick={() => setPag(ver - 1)}
              disabled={ver <= 1}
              aria-label="Página anterior"
            >
              ← Anterior
            </button>

            <button
              className={ghost + ' px-3 py-1 text-xs'}
              onClick={() => setPag(ver + 1)}
              disabled={ver >= pag}
              aria-label="Página siguiente"
            >
              Siguiente →
            </button>
          </div>
        </div>
      </Card>

      {men &&
        createPortal(
          <ul
            role="menu"
            data-menu
            aria-label={`Acciones de ${men.u.nombre}`}
            className="fixed z-40 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
            style={{ top: men.top, left: men.left }}
          >
            <li role="none">
              <button
                role="menuitem"
                className="block w-full px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-50"
                onClick={() => {
                  setMen(null);
                  setSel(rolesDe(men.u));
                  setCambio(men.u);
                }}
              >
                Asignar roles
              </button>
            </li>

            {!esYo(men.u) && (
              <li role="none">
                <button
                  role="menuitem"
                  className="block w-full px-3 py-1.5 text-left text-xs text-red-700 hover:bg-red-50"
                  onClick={() => {
                    setMen(null);
                    setBorrar(men.u);
                  }}
                >
                  Eliminar cuenta
                </button>
              </li>
            )}
          </ul>,
          document.body
        )}

      {cambio && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && setCambio(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rol-t"
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h3 id="rol-t" className="text-sm font-semibold text-slate-900">
              Asignar roles a {cambio.nombre}
            </h3>

            <p className="mt-1 text-xs text-slate-500">
              {cambio.email} · roles actuales:{' '}
              <b className="text-slate-700">
                {rolesDe(cambio).map((r) => ROL_LABEL[r] || r).join(', ')}
              </b>
            </p>

            <p className="mt-2 text-[11px] leading-snug text-slate-500">
              La cuenta puede tener varios roles a la vez y suma los permisos de todos.
              El marcado con «·» es el rol activo con el que se identifica en la sesión.
            </p>

            <div className="mt-4 space-y-1.5">
              {ROLES.map((r, i) => {
                const activo = sel.includes(r);
                return (
                  <label
                    key={r}
                    className={
                      'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors ' +
                      (activo
                        ? 'border-emerald-300 bg-emerald-50'
                        : 'border-slate-200 hover:bg-slate-50')
                    }
                  >
                    <input
                      ref={(el) => {
                        if (i === 0) enfoque.current = el;
                      }}
                      type="checkbox"
                      aria-label={ROL_LABEL[r]}
                      checked={activo}
                      onChange={() =>
                        setSel(activo ? sel.filter((x) => x !== r) : [...sel, r])
                      }
                      className="mt-0.5 accent-emerald-700"
                    />

                    <span>
                      <span className="block text-sm font-medium text-slate-800">
                        {ROL_LABEL[r]}
                        {r === cambio.rol ? ' ·' : ''}
                      </span>

                      <span className="block text-[11px] leading-snug text-slate-500">
                        {ROL_DESC[r]}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                className={ghost + ' px-3 py-1.5 text-xs'}
                onClick={() => setCambio(null)}
              >
                Cancelar
              </button>

              <button
                className={btn + ' px-3 py-1.5 text-xs'}
                onClick={aplicarRoles}
                disabled={!sel.length}
              >
                Guardar {sel.length} rol(es)
              </button>
            </div>
          </div>
        </div>
      )}

      {borrar && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && setBorrar(null)}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="borrar-t"
            aria-describedby="borrar-d"
            className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-xl"
          >
            <h3 id="borrar-t" className="text-sm font-semibold text-slate-900">
              Eliminar a {borrar.nombre}
            </h3>

            <p id="borrar-d" className="mt-2 text-xs text-slate-600">
              {borrar.email}. Sus incidencias conservan el nombre y el correo con
              que fueron creadas, así que la trazabilidad no se pierde, pero el
              acceso queda cerrado de inmediato.
            </p>

            <div className="mt-4 flex justify-end gap-2">
              <button
                ref={cancelar}
                className={ghost + ' px-3 py-1.5 text-xs'}
                onClick={() => setBorrar(null)}
              >
                Cancelar
              </button>

              <button
                className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50"
                onClick={confirmarBaja}
                disabled={elim}
              >
                {elim ? 'Eliminando…' : 'Sí, eliminar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 15. COMPONENTE PRINCIPAL DE LA APLICACIÓN
// ============================================================

export default function App() {
  const [user, setUser] = useState<any>(null);
  const [ready, setReady] = useState(false);

  const [view, go] = useState<any>({
    v: 'inicio',
  });

  const [perfil, setPerfil] = useState(false);

  // Selector de rol activo (patrón de Innovaplay): el diálogo y la elección pendiente viven
  // aquí, antes del retorno temprano al login, para no cambiar el orden de los hooks.
  const [rolDlg, setRolDlg] = useState(false);
  const [rolEleg, setRolEleg] = useState<string | null>(null);

  // Al salir se descartan los borradores locales del dispositivo y la sesión guardada
  const salir = () => {
    Object.keys(localStorage).forEach((k) => {
      if (k.startsWith('c:')) {
        localStorage.removeItem(k);
      }
    });

    localStorage.removeItem('t');
    olvidarRolActivo(user?.id);

    setPerfil(false);
    setRolDlg(false);
    setUser(null);
    go({ v: 'inicio' });
  };

  useEffect(() => {
    if (!perfil) return;

    const esc = (e: any) => e.key === 'Escape' && setPerfil(false);
    document.addEventListener('keydown', esc);

    return () => document.removeEventListener('keydown', esc);
  }, [perfil]);

  useEffect(() => {
    if (!rolDlg) return;

    const esc = (e: any) => e.key === 'Escape' && setRolDlg(false);
    document.addEventListener('keydown', esc);

    return () => document.removeEventListener('keydown', esc);
  }, [rolDlg]);

  // ----------------------------------------------------------
  // Foto de perfil: bucket privado usuarios-archivos, visible solo por URL firmada
  // ----------------------------------------------------------

  const [foto, setFoto] = useState<string | null>(null);
  const [fotoMsg, setFotoMsg] = useState('');
  const [fotoOk, setFotoOk] = useState('');
  const [fotoC, setFotoC] = useState(false);

  useEffect(() => {
    if (!user?.id) {
      setFoto(null);
      return;
    }

    let vivo = true;

    api(`/users/${user.id}/avatar`)
      .then((d: any) => vivo && setFoto(d.avatar?.url || null))
      .catch(() => vivo && setFoto(null));

    return () => {
      vivo = false;
    };
  }, [perfil, user?.id, user?.avatar?.fecha]);

  const ponFoto = async (f?: File) => {
    if (!f) return;

    setFotoMsg('');
    setFotoOk('');

    // Comodidad local: el servidor repite estas reglas y además verifica el contenido real
    if (!IMG.includes(f.type)) return setFotoMsg('La foto debe ser JPG, PNG o WebP');
    if (f.size > LIM_FOTO) return setFotoMsg('La foto de perfil debe pesar menos de 5 MB');

    const fd = new FormData();
    fd.append('avatar', f);

    setFotoC(true);

    try {
      const u = await api(`/users/${user.id}/avatar`, { method: 'PUT', body: fd });
      setUser({ ...user, ...u });
      const v = await api(`/users/${u.id}/avatar`);
      setFoto(v.avatar?.url || null);
      setFotoOk('Foto guardada en ' + (v.avatar?.bucket || 'el bucket de perfiles'));
    } catch (x: any) {
      setFotoMsg(x.message);
    } finally {
      setFotoC(false);
    }
  };

  const quitaFoto = () => {
    setFotoMsg('');
    setFotoOk('');
    setFotoC(true);

    api(`/users/${user.id}/avatar`, { method: 'DELETE' })
      .then((u: any) => {
        setUser({ ...user, avatar: u.avatar });
        setFoto(null);
        setFotoOk('Foto eliminada también del almacenamiento');
      })
      .catch((x: any) => setFotoMsg(x.message))
      .finally(() => setFotoC(false));
  };

  // ----------------------------------------------------------
  // Recuperar sesión guardada
  // ----------------------------------------------------------

  useEffect(() => {
    const t = localStorage.getItem('t');

    if (!t) {
      setReady(true);
      return;
    }

    // La identidad y los roles se leen del servidor, nunca del token en claro
    api('/auth/me')
      .then((d: any) => {
        setUser(d);
        go({ v: veStats(d) && !interviene(d) && !reporta(d) ? 'stats' : 'inicio' });
      })
      .catch(() => localStorage.removeItem('t'));

    setReady(true);
  }, []);

  // Un cambio de roles lo decide el servidor en cada petición; la interfaz vuelve a leer la
  // sesión al recuperar la pestaña (o tras una asignación hecha aquí) para que la navegación
  // y las etiquetas coincidan con los permisos reales sin cerrar la sesión.
  useEffect(() => {
    if (!user) return;

    const jala = () =>
      api('/auth/me')
        .then((d: any) => d && setUser((p: any) => ({ ...p, ...d })))
        .catch(() => {});

    window.addEventListener('focus', jala);
    window.addEventListener('sesion-cambiada', jala);
    document.addEventListener('visibilitychange', jala);

    return () => {
      window.removeEventListener('focus', jala);
      window.removeEventListener('sesion-cambiada', jala);
      document.removeEventListener('visibilitychange', jala);
    };
  }, [user]);

  // Equivalente a ProtectedRoute del proyecto de referencia: si la pantalla abierta no
  // pertenece al rol recién activado, se aterriza en el panel de ese rol en lugar de dejar
  // la vista a medias. 'detalle' queda fuera porque es una ficha, no una sección del menú.
  const SECCIONES = ['inicio', 'lista', 'nueva', 'pendientes', 'usuarios', 'stats', 'kb'];

  useEffect(() => {
    if (!user) return;
    const act = rolActivo(user, rolesDe(user));
    const permite: string[] = NAV_ROL[act] || [];

    if (SECCIONES.includes(view?.v) && !permite.includes(view.v)) {
      go({ v: VISTA_ROL[act] || 'inicio' });
    }
  }, [user, view?.v]);

  // ----------------------------------------------------------
  // Estado de conexión y sincronización offline
  // ----------------------------------------------------------

  const [online, setOnline] = useState(
    navigator.onLine
  );

  // Dónde escribe realmente la API conectada: la demo de dev:local es una base en memoria
  const [almacen, setAlmacen] = useState<string | null>(null);
  const [storage, setStorage] = useState<any>(null);

  // Ningún texto de la interfaz afirma "MongoDB Atlas" sin que la API lo confirme
  const enAtlas = almacen === 'atlas';

  useEffect(() => {
    let vivo = true;
    estado()
      .then((r: any) => {
        if (vivo) {
          setAlmacen(r?.almacen || null);
          setStorage(r?.storage || null);
        }
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  const [pend, setPend] = useState(0);
  const [inst, setInst] = useState<any>(null);

  const refresh = () =>
    countDrafts()
      .then(setPend)
      .catch(() => {});

  const doSync = async () => {
    if (
      !localStorage.getItem('t') ||
      !navigator.onLine
    ) {
      return;
    }

    try {
      const r = await syncDrafts(api);

      await refresh();

      if (r.ok || r.fail) {
        alert(
          `Sincronización: ${r.ok} enviadas${
            r.fail
              ? ', ' +
                r.fail +
                ' descartadas por datos inválidos'
              : ''
          }`
        );
      }
    } catch (x: any) {
      console.error(
        'Error al sincronizar borradores:',
        x.message
      );
    }
  };

  useEffect(() => {
    refresh();

    const on = () => {
      setOnline(true);
      doSync();
    };

    const off = () => setOnline(false);

    const bp = (e: any) => {
      e.preventDefault();
      setInst(e);
    };

    addEventListener('online', on);
    addEventListener('offline', off);
    addEventListener('drafts-changed', refresh);
    addEventListener('beforeinstallprompt', bp);

    // Se vacía la cola al iniciar sesión y al recuperar conexión; un intervalo
    // de 30 s reabría la API aunque no hubiera borradores pendientes.
    if (navigator.onLine) doSync();

    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
      removeEventListener('drafts-changed', refresh);
      removeEventListener('beforeinstallprompt', bp);
    };
  }, [user]);

  // ----------------------------------------------------------
  // Pantallas iniciales
  // ----------------------------------------------------------

  if (!ready) {
    return null;
  }

  if (!user) {
    return (
      <Login
        onLogin={(u: any) => {
          setUser(u);
          go({ v: veStats(u) && !interviene(u) && !reporta(u) ? 'stats' : 'inicio' });
        }}
      />
    );
  }

  // ----------------------------------------------------------
  // Navegación según el rol ACTIVO de la sesión. El conjunto `roles` es lo que el servidor
  // autoriza (unión), pero la interfaz muestra solo las secciones del rol elegido, igual que
  // los menús por rol del proyecto de referencia.
  // ----------------------------------------------------------

  const activo = rolActivo(user, rolesDe(user));
  const vistasRol: string[] = NAV_ROL[activo] || [];

  const tituloLista = gestiona(user)
    ? 'Incidencias'
    : tiene(user, 'tecnico')
      ? 'Incidencias asignadas'
      : 'Mis incidencias';

  const nav = vistasRol.map((k: string) =>
    k === 'inicio'
      ? ['inicio', activo === 'tecnico' ? 'Mi bandeja' : 'Panel', '▦']
      : k === 'lista'
        ? ['lista', tituloLista, '▤']
        : k === 'nueva'
          ? ['nueva', 'Nueva incidencia', '+']
          : k === 'pendientes'
            ? ['pendientes', 'Por autorizar', '★']
            : k === 'usuarios'
              ? ['usuarios', 'Usuarios', '▨']
              : k === 'stats'
                ? ['stats', gestiona(user) ? 'Estadísticas' : 'Panel de indicadores', '▮']
                : ['kb', 'Base de conocimiento', '?']
  );

  // Confirmar en el diálogo escribe activeRole_<id> y aterrizó en el panel del rol elegido;
  // el token y los permisos del servidor no cambian, solo el contexto de trabajo.
  const cambiarRol = () => {
    if (!rolEleg || rolEleg === activo) {
      setRolDlg(false);
      return;
    }
    fijarRolActivo(user.id, rolEleg);
    setRolDlg(false);
    setUser({ ...user });
    go({ v: VISTA_ROL[rolEleg] || 'inicio' });
  };

  const Nav = ({ c = '' }: any) =>
    nav.map(([k, l, i]) => (
      <button
        key={k}
        onClick={() => go({ v: k })}
        className={
          'flex items-center gap-2.5 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors ' +
          (view.v === k
            ? 'bg-emerald-50 font-medium text-emerald-800'
            : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
        }
      >
        <span className="w-4 text-center text-xs text-slate-400">
          {i}
        </span>

        {l}
      </button>
    ));

  // ----------------------------------------------------------
  // Interfaz general
  // ----------------------------------------------------------

  return (
    <div className="min-h-screen">
      {/* Encabezado */}

      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur print:hidden!">
        <div className="flex w-40 items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-700 text-sm font-bold text-white">
            U
          </span>

          <div className="leading-tight">
            <b className="text-sm text-slate-900">
              UTM Desk
            </b>

            <p className="text-[10px] text-slate-400">
              NoSQL Cloud Helpdesk
            </p>
          </div>
        </div>

        <span
          className={
            'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] xl:inline ' +
            (online && enAtlas
              ? 'bg-emerald-50 text-emerald-700'
              : 'bg-amber-50 text-amber-700')
          }
        >
          {!online
            ? '● Sin conexión · ' + pend + ' borradores'
            : enAtlas
              ? '● Conectado · MongoDB Atlas'
              : almacen === 'local'
                ? '● Conectado · base local (sin Atlas)'
                : '● Conectado · almacén sin confirmar'}
        </span>

        {storage && (
          <span
            title={storage.hay ? 'Buckets visibles: ' + storage.buckets.join(', ') : storage.motivo}
            className={
              'hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] xl:inline ' +
              (storage.hay ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')
            }
          >
            {storage.hay
              ? '● Archivos · Supabase (' + (storage.buckets?.length || 0) + ' buckets)'
              : '● Archivos sin guardar'}
          </span>
        )}

        {/* La búsqueda vive en el listado; el encabezado solo concentra acciones */}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {pend > 0 && (
            <button
              className={ghost + ' !px-2.5 !py-1.5 text-xs whitespace-nowrap'}
              onClick={doSync}
            >
              Sincronizar ({pend})
            </button>
          )}

          {inst && (
            <button
              className={ghost + ' !px-2.5 !py-1.5 text-xs whitespace-nowrap'}
              onClick={async () => {
                await inst.prompt();
                setInst(null);
              }}
            >
              Instalar PWA
            </button>
          )}

          {vistasRol.includes('nueva') && (
            <button
              className={btn + ' hidden whitespace-nowrap sm:block'}
              onClick={() => go({ v: 'nueva' })}
            >
              + Nueva incidencia
            </button>
          )}

          {/* Con un solo rol la etiqueta es estática; con varios se vuelve el selector de rol */}

          {rolesDe(user).length > 1 ? (
            <button
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50"
              aria-haspopup="dialog"
              aria-expanded={rolDlg}
              title={`${ROL_LABEL[activo] || activo} — cambiar de rol`}
              onClick={() => {
                setRolEleg(activo);
                setRolDlg(true);
              }}
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${PUNTO_ROL[activo] || 'bg-slate-400'}`}
              />

              {ROL_LABEL[activo] || activo}

              <span className="text-slate-400">▾</span>
            </button>
          ) : (
            <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600 sm:block">
              {etiquetaRoles(user)}
            </span>
          )}

          <button
            className={
              'grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold transition-colors ' +
              (perfil
                ? 'bg-emerald-100 text-emerald-800'
                : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-800')
            }
            aria-label={`${user.nombre}, ${etiquetaRoles(user)}. Ver mi perfil`}
            aria-haspopup="dialog"
            aria-expanded={perfil}
            title={`${user.nombre} · ${etiquetaRoles(user)} — ver mi perfil`}
            onClick={() => setPerfil(!perfil)}
          >
            {foto ? (
              <img
                src={foto}
                alt={`Foto de perfil de ${user.nombre}`}
                onError={() => setFoto(null)}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              user.nombre?.[0] || 'U'
            )}
          </button>
        </div>
      </header>

      <div className="flex">
        {/* Navegación lateral */}

        <aside className="sticky top-[57px] hidden h-[calc(100vh-57px)] w-56 shrink-0 flex-col border-r border-slate-200 bg-white p-3 print:hidden! md:flex">
          <p className="px-3 pb-2 pt-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            Navegación
          </p>

          <div className="flex flex-col gap-0.5">
            <Nav />
          </div>

          <div className="mt-auto rounded-lg border border-slate-100 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-500">
            <b className="text-slate-600">
              {enAtlas
                ? 'MongoDB Atlas'
                : almacen === 'local'
                  ? 'Base de datos local'
                  : 'Almacén sin confirmar'}
            </b>

            <br />

            {enAtlas
              ? 'Clúster académico en la nube · colecciones sincronizadas.'
              : almacen === 'local'
                ? 'Ejecuta npm run dev (puerto 4000) para escribir en el clúster.'
                : 'No hay API disponible para confirmar dónde se guardan los datos.'}
          </div>
        </aside>

        {/* Contenido principal */}

        <main className="min-w-0 flex-1 p-4 md:p-6">
          {/* Navegación móvil */}

          <div className="mb-4 flex gap-1 overflow-x-auto print:hidden! md:hidden">
            <Nav />
          </div>

          {/* Aviso de conexión */}

          {!online && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 print:hidden!">
              Sin conexión: puedes consultar datos en caché
              y guardar borradores; se enviarán al reconectar.
            </p>
          )}

          {almacen === 'local' && (
            <p role="status" className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 print:hidden!">
              Esta API no está conectada a <strong>MongoDB Atlas</strong>: lo que guardes se
              escribe en una base local y con <code>npm run dev:local</code> es memoria
              desechable que se pierde al reiniciar. Para trabajar sobre Atlas ejecuta{' '}
              <code className="rounded bg-white px-1 py-0.5 text-xs">npm run dev</code> en
              server/ y apunta{' '}
              <code className="rounded bg-white px-1 py-0.5 text-xs">VITE_API_URL</code> de
              client/.env.local a{' '}
              <code className="rounded bg-white px-1 py-0.5 text-xs">
                http://localhost:4000/api
              </code>
            </p>
          )}

          {/* Enrutamiento interno de vistas */}

          {view.v === 'inicio' && (
            <Dashboard
              user={user}
              go={go}
              enAtlas={enAtlas}
            />
          )}

          {view.v === 'lista' && (
            <Lista
              go={go}
              user={user}
            />
          )}

          {view.v === 'nueva' && (reporta(user)
            ? <Nueva go={go} user={user} enAtlas={enAtlas} storage={storage} />
            : <SinRol roles={etiquetaRoles(user)} accion="registrar incidencias" />)}

          {view.v === 'detalle' && (
            <Detalle
              id={view.id}
              user={user}
              go={go}
              ok={view.ok}
            />
          )}

          {view.v === 'stats' && veStats(user) && (
            <Stats user={user} />
          )}

          {view.v === 'kb' && (
            <KB user={user} />
          )}

          {view.v === 'usuarios' && gestiona(user) && <Usuarios user={user} />}

          {view.v === 'pendientes' && gestiona(user) && (
            <Lista
              init=""
              soloPendientes
              go={go}
              user={user}
            />
          )}
        </main>
      </div>

      {user && perfil && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && setPerfil(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="perfil-t"
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
              {foto ? (
                <img
                  src={foto}
                  alt={`Foto de perfil de ${user.nombre}`}
                  onError={() => setFoto(null)}
                  className="h-10 w-10 shrink-0 rounded-full object-cover"
                />
              ) : (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-50 text-base font-semibold text-emerald-800">
                  {user.nombre?.[0] || 'U'}
                </span>
              )}

              <div className="min-w-0 flex-1">
                <h3 id="perfil-t" className="truncate text-sm font-semibold text-slate-900">
                  {user.nombre}
                </h3>

                <p className="truncate text-xs text-slate-500">{user.email}</p>
              </div>

              <button
                className={ghost + ' px-2 py-1 text-xs'}
                onClick={() => setPerfil(false)}
                aria-label="Cerrar la ficha de perfil"
              >
                ✕
              </button>
            </div>

            <dl className="divide-y divide-slate-100 px-5 text-xs">
              {[
                ['Roles asignados', etiquetaRoles(user)],
                ['Rol en uso', ROL_LABEL[activo] || activo],
                ['Registro', fcha(user.creadoEn, true)],
                ['Último acceso', fcha(user.ultimoAcceso)],
                ['Identificador', String(user.id).slice(-8).toUpperCase()],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="text-right font-medium text-slate-800">{v}</dd>
                </div>
              ))}
            </dl>

            <div className="border-t border-slate-100 px-5 pt-3">
              <p className={lbl}>
                Foto de perfil · JPG, PNG o WebP · máx. 5 MB
              </p>

              <div className="flex flex-wrap items-center gap-3">
                <label className={ghost + ' cursor-pointer px-3 py-1.5 text-xs'}>
                  {fotoC
                    ? 'Subiendo…'
                    : user.avatar
                      ? 'Cambiar foto'
                      : 'Subir foto'}

                  <input
                    type="file"
                    hidden
                    disabled={fotoC}
                    accept={ACEPTA_FOTO}
                    onChange={(e) => {
                      ponFoto(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </label>

                {user.avatar && (
                  <button
                    className="text-xs text-slate-500 transition-colors hover:text-red-700 disabled:opacity-40"
                    onClick={quitaFoto}
                    disabled={fotoC}
                  >
                    Quitar foto
                  </button>
                )}
              </div>

              {!!fotoMsg && (
                <p role="alert" className="mt-2 text-xs text-red-700">
                  {fotoMsg}
                </p>
              )}

              {!!fotoOk && (
                <p role="status" className="mt-2 text-xs text-emerald-700">
                  {fotoOk}
                </p>
              )}
            </div>

            <p className="px-5 pb-1 pt-3 text-[11px] leading-relaxed text-slate-500">
              {rolesDe(user)
                .map((r) => `${ROL_LABEL[r] || r}: ${ROL_DESC[r] || ''}`.trim())
                .join(' · ') ||
                'El rol se verifica en cada petición del servidor, no solo en la interfaz.'}
            </p>

            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              <button
                className={ghost + ' px-3 py-1.5 text-xs'}
                onClick={() => setPerfil(false)}
              >
                Volver
              </button>

              <button
                className="rounded-lg bg-red-700 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
                onClick={salir}
              >
                Cerrar sesión
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de cambio de rol, adaptado de RoleSwitcherTopbar: tarjetas por rol asignado y
          Cancelar/Confirmar. Lo que autoriza el servidor no cambia: se elige el contexto. */}

      {rolDlg && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-slate-900/40 p-4"
          role="presentation"
          onClick={(e) => e.target === e.currentTarget && setRolDlg(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rol-t"
            className="w-full max-w-md overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
          >
            <div className="border-b border-slate-100 px-5 py-4 text-center">
              <h3 id="rol-t" className="text-base font-semibold text-slate-900">
                Cambiar de Rol
              </h3>

              <p className="mt-1 text-xs text-slate-500">
                Selecciona el rol que deseas usar en esta sesión.
              </p>
            </div>

            <div className="flex flex-col gap-2 px-5 py-4">
              {rolesDe(user).map((r: string) => {
                const esAct = r === rolEleg;

                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRolEleg(r)}
                    className={
                      'flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors ' +
                      (esAct
                        ? 'border-emerald-500 bg-emerald-50'
                        : 'border-slate-200 bg-white hover:bg-slate-50')
                    }
                  >
                    <span
                      className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${PUNTO_ROL[r] || 'bg-slate-400'}`}
                    />

                    <span className="min-w-0 flex-1">
                      <b className="block text-sm text-slate-900">
                        {ROL_LABEL[r] || r}
                        {r === activo && (
                          <span className="ml-2 text-[11px] font-normal text-slate-500">
                            (en uso)
                          </span>
                        )}
                      </b>

                      <span className="mt-0.5 block text-xs text-slate-500">
                        {ROL_DESC[r] || ''}
                      </span>
                    </span>

                    {esAct && (
                      <span className="text-sm text-emerald-700" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="flex gap-2 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                className={ghost + ' flex-1'}
                onClick={() => setRolDlg(false)}
              >
                Cancelar
              </button>

              <button
                type="button"
                className={btn + ' flex-1'}
                disabled={!rolEleg || rolEleg === activo}
                onClick={cambiarRol}
              >
                Confirmar
              </button>
            </div>

            <p className="px-5 pb-4 text-[11px] leading-relaxed text-slate-500">
              Tu cuenta tiene{' '}
              {rolesDe(user).length}{' '}
              roles asignados. El que actives decide el menú y la pantalla inicial; para{' '}
              <b>añadir o quitar</b> roles hace falta un perfil de Soporte TI en{' '}
              <b>Usuarios → Asignar roles</b>.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
