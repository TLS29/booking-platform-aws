/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  extends: 'dependency-cruiser/configs/recommended-strict',

  forbidden: [
    // ───────────────────────── Clean Architecture: regla de dependencia ─────────────────────────
    {
      name: 'domain-purity',
      severity: 'error',
      comment:
        'domain es puro: prohibido importar de application, infrastructure o interfaces. ' +
        'Si necesitas algo de afuera, declara un Port en domain/ports.',
      from: { path: '^src/domain' },
      to:   { path: '^src/(application|infrastructure|interfaces)' },
    },
    {
      name: 'application-only-domain',
      severity: 'error',
      comment:
        'application solo conoce domain (y libs puras). Nada de HTTP, DB ni adapters concretos. ' +
        'Si necesitas un adapter, inyéctalo vía un Port.',
      from: { path: '^src/application' },
      to:   { path: '^src/(infrastructure|interfaces)' },
    },
    {
      name: 'infrastructure-no-interfaces',
      severity: 'error',
      comment: 'los adapters (infrastructure) nunca deben depender de delivery mechanisms (interfaces).',
      from: { path: '^src/infrastructure' },
      to:   { path: '^src/interfaces' },
    },

    // ───────────────────────── Ports solo en domain ─────────────────────────
    {
      name: 'ports-only-in-domain',
      severity: 'error',
      comment:
        'Las interfaces de puertos viven SOLO en src/domain/ports. ' +
        'Si ves esto, mueve el archivo a domain/ports y déjale solo la interfaz (sin implementación).',
      from: {},
      to: {
        path: '/ports/',
        pathNot: '^src/domain/ports/',
      },
    },

    // ───────────────────────── Tecnologías encapsuladas ─────────────────────────
    {
      name: 'prisma-only-in-persistence',
      severity: 'error',
      comment:
        'Prisma es un detalle de infraestructura. Solo src/infrastructure/persistence/** ' +
        'puede importar @prisma/client. El resto del código habla con Ports del dominio.',
      from: {
        path: '^src',
        pathNot: '^src/infrastructure/persistence/',
      },
      to: {
        path: '^@prisma/client(/|$)|^\\.?\\.?/prisma(/|$)',
      },
    },
    {
      name: 'express-only-in-http',
      severity: 'error',
      comment:
        'Express es un delivery mechanism. Solo src/interfaces/http/** puede importar express. ' +
        'Los use cases reciben DTOs, no Request/Response.',
      from: {
        path: '^src',
        pathNot: '^src/interfaces/http/',
      },
      to: {
        path: '^express(/|$)',
      },
    },

    // ───────────────────────── Higiene general ─────────────────────────
    {
      name: 'no-test-utils-in-prod',
      severity: 'error',
      comment: 'código de producción no debe depender de tests, fixtures ni mocks.',
      from: {
        path: '^src',
        pathNot: '\\.(spec|test)\\.ts$',
      },
      to: {
        path: '(__tests__|__mocks__|__fixtures__|\\.(spec|test)\\.ts$)',
      },
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },

    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,

    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      mainFields: ['main', 'types'],
    },

    reporterOptions: {
      dot: {
        collapsePattern: 'node_modules/(?:@[^/]+/)?[^/]+',
        theme: {
          graph: { splines: 'ortho', rankdir: 'LR' },
          modules: [
            { criteria: { source: '^src/domain' },         attributes: { fillcolor: '#ccffcc' } },
            { criteria: { source: '^src/application' },    attributes: { fillcolor: '#ffffcc' } },
            { criteria: { source: '^src/infrastructure' }, attributes: { fillcolor: '#ffcccc' } },
            { criteria: { source: '^src/interfaces' },     attributes: { fillcolor: '#ccccff' } },
          ],
        },
      },
      archi: { collapsePattern: '^(src/[^/]+)' },
    },
  },
};
