// 从本机 Metro 二进制缓存恢复等价的项目模块，并去掉打包器外壳。
// 仅处理项目自己的模块，绝不复制或修改第三方包源码。
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const t = require('@babel/types');
const generate = require('@babel/generator').default;
const { decode } = require('../../node_modules/expo/node_modules/@expo/metro-config/build/binary-file-store/serializer.js');

const cache = '.expo/build-temp/metro-cache';
if (fs.existsSync('App.js') && !process.argv.includes('--overwrite-recovered')) {
  throw new Error('业务源码已存在。仅在明确需要灾难恢复时使用 --overwrite-recovered，防止覆盖后续修复。');
}
const modules = new Map();
for (const shard of fs.readdirSync(cache)) {
  for (const file of fs.readdirSync(path.join(cache, shard))) {
    let item;
    try { item = decode(fs.readFileSync(path.join(cache, shard, file))); } catch { continue; }
    const code = item.output?.find(output => output.type === 'js/module')?.data.code;
    if (!code) continue;
    let destination;
    if (code.includes('function Shike()') && code.includes('PhotoViewer')) destination = 'App.js';
    else if (code.includes('class Repository') && code.includes('source_asset_id')) destination = 'src/data/repository.js';
    else if (code.includes('function CaptureScreen(')) destination = 'src/components/CaptureScreen.js';
    else if (code.includes('function ZoomablePhoto(')) destination = 'src/components/PhotoViewer.js';
    else if (code.includes('function calendarCells(') && code.includes('function dayKey(')) destination = 'src/domain/model.js';
    else if (code.includes('function decodeBackup(') && code.includes('function encodeBackup(')) destination = 'src/domain/backup-format.js';
    if (!destination) continue;
    // 同一模块可能有多个缓存版本，优先保留功能更完整的版本。
    const existing = modules.get(destination);
    if (!existing || code.length > existing.code.length) modules.set(destination, { code, item });
  }
}

function jsxName(node) {
  if (t.isIdentifier(node)) return t.jsxIdentifier(node.name);
  if (t.isStringLiteral(node)) return t.jsxIdentifier(node.value);
  if (t.isMemberExpression(node)) return t.jsxMemberExpression(jsxName(node.object), jsxName(node.property));
  throw new Error('不支持的 JSX 标签');
}

for (const [destination, { code, item }] of modules) {
  const parsed = parser.parse(code);
  const wrapper = parsed.program.body[0].expression.arguments[0];
  const ast = t.file(t.program(wrapper.body.body));
  const aliases = new Map();
  const namespaceNames = {
    react: 'React', 'react-native': 'RN',
    'react-native-safe-area-context': 'SafeArea',
    '../domain/model': 'Domain', './src/domain/model': 'Domain',
    '../domain/backup-format': 'BackupFormat',
  };
  const exports = new Set();
  let defaultExport;
  const imports = [];

  traverse(ast, {
    VariableDeclarator(p) {
      if (!t.isCallExpression(p.node.init) || !t.isIdentifier(p.node.init.callee, { name: 'require' })) return;
      const index = p.node.init.arguments[0].property.value;
      aliases.set(p.node.id.name, { dependency: item.dependencies[index].name, declaration: p.parentPath });
    },
  });
  const handled = new Set();
  traverse(ast, {
    VariableDeclarator(p) {
      const init = p.node.init;
      if (!t.isCallExpression(init) || !t.isIdentifier(init.callee)
        || !['_interopNamespace', '_interopDefault'].includes(init.callee.name)) return;
      const alias = aliases.get(init.arguments[0]?.name);
      if (!alias) return;
      const name = p.node.id.name;
      const isDefault = init.callee.name === '_interopDefault';
      imports.push(t.importDeclaration([isDefault ? t.importDefaultSpecifier(t.identifier(name))
        : t.importNamespaceSpecifier(t.identifier(name))], t.stringLiteral(alias.dependency)));
      handled.add(init.arguments[0].name);
      if (isDefault) {
        traverse(ast, { MemberExpression(member) {
          if (t.isIdentifier(member.node.object, { name })
            && t.isIdentifier(member.node.property, { name: 'default' })) member.replaceWith(t.identifier(name));
        } });
      }
      p.parentPath.remove();
    },
  });
  for (const [alias, { dependency, declaration }] of aliases) {
    if (!handled.has(alias) && dependency !== 'react/jsx-runtime') {
      const name = namespaceNames[dependency] || alias.replace(/^_/, '');
      declaration.scope.rename(alias, name);
      imports.push(t.importDeclaration([t.importNamespaceSpecifier(t.identifier(name))], t.stringLiteral(dependency)));
    }
    declaration.remove();
  }
  traverse(ast, {
    FunctionDeclaration(p) {
      if (['_interopNamespace', '_interopDefault'].includes(p.node.id.name)) p.remove();
    },
    ExpressionStatement(p) {
      const expression = p.node.expression;
      if (t.isCallExpression(expression) && t.isMemberExpression(expression.callee)
        && t.isIdentifier(expression.callee.object, { name: 'Object' })
        && t.isIdentifier(expression.callee.property, { name: 'defineProperty' })
        && t.isIdentifier(expression.arguments[0], { name: 'exports' })) {
        const name = expression.arguments[1].value;
        if (name !== '__esModule') {
          const getter = expression.arguments[2].properties.find(prop => prop.key.name === 'get');
          const id = getter.value.body.body.find(statement => t.isReturnStatement(statement)).argument.name;
          if (name === 'default') defaultExport = id; else exports.add(id);
        }
        p.remove();
      }
    },
    AssignmentExpression: { exit(p) {
      if (!t.isMemberExpression(p.node.left) || !t.isIdentifier(p.node.left.object, { name: 'exports' })) return;
      const right = p.node.right;
      if (t.isIdentifier(right)) exports.add(right.name);
      else if (!t.isUnaryExpression(right, { operator: 'void' })) exports.add(p.node.left.property.name);
      if (p.parentPath.isExpressionStatement()) p.parentPath.remove(); else p.replaceWith(right);
    } },
    CallExpression: { exit(p) {
      const callee = t.isSequenceExpression(p.node.callee) ? p.node.callee.expressions.at(-1) : p.node.callee;
      if (!t.isMemberExpression(callee) || !t.isIdentifier(callee.object, { name: '_reactJsxRuntime' })
        || !['jsx', 'jsxs'].includes(callee.property.name)) return;
      const [tag, props, key] = p.node.arguments;
      const attributes = [];
      const children = [];
      for (const property of props?.properties || []) {
        if (t.isSpreadElement(property)) { attributes.push(t.jsxSpreadAttribute(property.argument)); continue; }
        const name = property.key.name ?? property.key.value;
        if (name === 'children') {
          const values = t.isArrayExpression(property.value) ? property.value.elements : [property.value];
          for (const value of values) if (value) children.push(t.isJSXElement(value) || t.isJSXFragment(value)
            ? value : t.jsxExpressionContainer(value));
        } else attributes.push(t.jsxAttribute(t.jsxIdentifier(name), t.jsxExpressionContainer(property.value)));
      }
      if (key) attributes.push(t.jsxAttribute(t.jsxIdentifier('key'), t.jsxExpressionContainer(key)));
      if (t.isMemberExpression(tag) && tag.property.name === 'Fragment') {
        p.replaceWith(t.jsxFragment(t.jsxOpeningFragment(), t.jsxClosingFragment(), children));
      } else {
        const name = jsxName(tag);
        p.replaceWith(t.jsxElement(t.jsxOpeningElement(name, attributes, !children.length),
          children.length ? t.jsxClosingElement(t.cloneNode(name)) : null, children, !children.length));
      }
    } },
  });
  traverse(ast, { CallExpression(p) {
    const callee = p.node.callee;
    if (t.isSequenceExpression(callee) && callee.expressions.length === 2
      && t.isNumericLiteral(callee.expressions[0], { value: 0 })) p.node.callee = callee.expressions[1];
  } });
  traverse(ast, { Program(p) { p.scope.crawl(); }, VariableDeclaration(p) {
    if (p.node.kind !== 'var' && p.node.kind !== 'let') return;
    const names = Object.keys(t.getBindingIdentifiers(p.node));
    p.node.kind = names.every(name => p.scope.getBinding(name)?.constant) ? 'const' : 'let';
  } });
  ast.program.body.unshift(...imports);
  if (exports.size) ast.program.body.push(t.exportNamedDeclaration(null,
    [...exports].map(name => t.exportSpecifier(t.identifier(name), t.identifier(name)))));
  if (defaultExport) ast.program.body.push(t.exportDefaultDeclaration(t.identifier(defaultExport)));
  traverse(ast, { enter(p) {
    for (const key of ['leadingComments', 'innerComments', 'trailingComments']) {
      if (p.node[key]) p.node[key] = p.node[key].filter(comment => !comment.value.includes('#__PURE__'));
    }
    if (t.isStringLiteral(p.node)) delete p.node.extra;
  } });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, '// 从先前构建缓存恢复的等价模块，已移除 Metro 外壳并恢复 JSX。\n'
    + generate(ast, { comments: true, jsescOption: { minimal: true } }).code + '\n');
  console.log(destination);
}
if (modules.size !== 6) throw new Error(`预期恢复 6 个模块，实际 ${modules.size}`);
