#!/usr/bin/env bun
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve as resolvePath } from 'node:path';

import { cancel, confirm, intro, isCancel, outro, select, spinner, text } from '@clack/prompts';
import type { KeyEvent } from '@opentui/core';
import pc from 'picocolors';

type ActionConfig = Record<string, { command?: string }>;
interface InitCommands {
  initCommand: string;
  runCommand: string;
}

interface PromptOption {
  value: string;
  label: string;
  hint?: string;
}

const home = process.env['HOME'] ?? '';
const wtHome = process.env['WT_HOME'] ?? join(home, '.wt');
const wtWorktreesDir = process.env['WT_WORKTREES_DIR'] ?? join(wtHome, 'worktrees');
const wtArchivedDir = process.env['WT_ARCHIVED_DIR'] ?? join(wtHome, 'archived');
const defaultInitCommand = 'bun install --frozen-lockfile && bun run migrate-ledgers';
const defaultRunCommand = 'bun run start:dev-fastest';
const darkPanel = '#282C34';
const darkInput = '#15161D';
const darkInputFocused = '#3A2A36';
const lightText = '#F3F4F6';
const mutedText = '#9CA3AF';
const pinkHex = '#F472B6';

class WtError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WtError';
  }
}

const colorEnabled =
  process.env['NO_COLOR'] === undefined &&
  !process.argv.includes('--no-color') &&
  (process.env['FORCE_COLOR'] !== undefined ||
    process.argv.includes('--color') ||
    process.platform === 'win32' ||
    (process.stdout.isTTY && process.env['TERM'] !== 'dumb') ||
    process.env['CI'] !== undefined);

const esc = '\u001B';
const muted = (value: string): string => ansi(value, `${esc}[90m`, `${esc}[39m`);
const black = (value: string): string => ansi(value, `${esc}[30m`, `${esc}[39m`);
const bold = (value: string): string => ansi(value, `${esc}[1m`, `${esc}[22m`);
const pink = (value: string): string => ansi(value, `${esc}[38;2;244;114;182m`, `${esc}[39m`);
const pinkBg = (value: string): string => ansi(value, `${esc}[48;2;244;114;182m`, `${esc}[49m`);

function ansi(value: string, open: string, close: string): string {
  return colorEnabled ? `${open}${value}${close}` : value;
}

interface HelpRow {
  command: string;
  args?: string;
  description: string;
}

const helpRows: HelpRow[] = [
  { command: 'init', description: 'Create local worktree action config' },
  {
    command: 'new',
    args: '[--base REF] [--no-fetch] [NAME]',
    description: 'Create a managed worktree',
  },
  { command: 'list', args: '[--all]', description: 'Show managed worktrees' },
  { command: 'goto', args: '[root|NAME|PATH]', description: 'Print a directory for cd' },
  { command: 'shell-init', description: 'Print shell integration for goto' },
  { command: 'open', args: '[NAME|PATH]', description: 'Open a worktree in Cursor' },
  { command: 'rename', args: 'NAME|PATH NEW_NAME', description: 'Rename a managed worktree' },
  { command: 'run', args: 'ACTION', description: 'Run an action in the current repo' },
  { command: 'run', args: 'NAME|PATH ACTION', description: 'Run an action in another worktree' },
  {
    command: 'archive',
    args: '[--force] NAME|PATH',
    description: 'Move a managed worktree to ~/.wt/archived; --force skips confirmation',
  },
];

const commandAliases: Record<string, string> = {
  '--help': 'help',
  '-h': 'help',
  delete: 'archive',
  ls: 'list',
  remove: 'archive',
  rm: 'archive',
};

function helpLine({ command, args, description }: HelpRow, width: number): string {
  const plain = `wt ${command}${args === undefined ? '' : ` ${args}`}`;
  const styled = `${muted('wt')} ${pink(command)}${args === undefined ? '' : ` ${muted(args)}`}`;
  return `  ${styled}${' '.repeat(width - plain.length)}  ${description}`;
}

function helpSection(label: string): string {
  return pink(label.toUpperCase());
}

function usage(): string {
  const commandWidth = Math.max(
    ...helpRows.map(
      ({ command, args }) => `wt ${command}${args === undefined ? '' : ` ${args}`}`.length,
    ),
  );
  const title = `${pinkBg(black(' wt '))} ${bold('Git worktrees, kept close')}`;
  const actionPath = `${muted('<base-repo>')}/${pink('.wt/actions.json')}`;

  return [
    '',
    title,
    muted('Small Bun CLI for making, opening, and running Git worktrees.'),
    '',
    helpSection('Commands'),
    ...helpRows.map((row) => helpLine(row, commandWidth)),
    '',
    helpSection('Storage'),
    `  ${muted('worktrees')}  ${pink('~/.wt/worktrees')}/${muted('<project-name>/<worktree-name>')}`,
    `  ${muted('archived')}   ${pink('~/.wt/archived')}/${muted('<project-name>/<worktree-name>-<timestamp>')}`,
    `  ${muted('actions')}    ${actionPath}`,
    '',
    helpSection('Examples'),
    `  ${muted('$')} wt ${pink('init')}`,
    `  ${muted('$')} wt ${pink('new')} ${muted('--base origin/main')}`,
    `  ${muted('$')} eval ${muted('"$(wt shell-init)"')}`,
    `  ${muted('$')} wt ${pink('goto')} ${muted('root')}`,
    `  ${muted('$')} wt ${pink('run')} ${muted('nako-haru-7188 dev')}`,
    `  ${muted('$')} wt ${pink('rename')} ${muted('nako-haru-7188 nako-tsubaki-2043')}`,
    `  ${muted('$')} wt ${pink('archive')} ${muted('nako-haru-7188')}`,
  ].join('\n');
}

function fail(message: string): never {
  throw new WtError(message);
}

function runBin(
  bin: string,
  args: string[],
  options: { cwd?: string; inherit?: boolean; allowFail?: boolean } = {},
): string {
  const spawnOptions = {
    stdout: options.inherit === true ? 'inherit' : 'pipe',
    stderr: options.inherit === true ? 'inherit' : 'pipe',
    stdin: 'inherit',
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  } as const;
  const proc = Bun.spawnSync([bin, ...args], spawnOptions);

  if (proc.exitCode !== 0 && options.allowFail !== true) {
    const stderr = proc.stderr === undefined ? '' : new TextDecoder().decode(proc.stderr).trim();
    fail(stderr || `${bin} ${args.join(' ')} failed`);
  }

  return proc.stdout === undefined ? '' : new TextDecoder().decode(proc.stdout).trimEnd();
}

function git(
  args: string[],
  cwd = process.cwd(),
  options: { inherit?: boolean; allowFail?: boolean } = {},
): string {
  return runBin('git', args, { cwd, ...options });
}

function isGitRepo(cwd = process.cwd()): boolean {
  const proc = Bun.spawnSync(['git', 'rev-parse', '--is-inside-work-tree'], {
    cwd,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return proc.exitCode === 0;
}

function requireGitRepo(cwd = process.cwd()): void {
  if (!isGitRepo(cwd)) {
    fail('must be run inside a git repository');
  }
}

function repoRoot(cwd = process.cwd()): string {
  return git(['rev-parse', '--show-toplevel'], cwd);
}

function gitCommonDir(cwd = process.cwd()): string {
  return git(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
}

function baseRepoRoot(cwd = process.cwd()): string {
  const root = repoRoot(cwd);
  const common = gitCommonDir(cwd);
  return common.endsWith('/.git') ? dirname(common) : root;
}

function projectName(cwd = process.cwd()): string {
  return (
    baseRepoRoot(cwd)
      .split('/')
      .findLast((part) => part !== '') ?? 'project'
  );
}

function refExists(ref: string, cwd = process.cwd()): boolean {
  const proc = Bun.spawnSync(['git', 'rev-parse', '--verify', '--quiet', ref], {
    cwd,
    stdout: 'ignore',
    stderr: 'ignore',
  });
  return proc.exitCode === 0;
}

function defaultBaseRef(cwd = process.cwd()): string {
  for (const remote of ['origin', 'upstream']) {
    if (refExists(`refs/remotes/${remote}/HEAD`, cwd)) {
      const ref = git(['symbolic-ref', '--quiet', '--short', `refs/remotes/${remote}/HEAD`], cwd, {
        allowFail: true,
      });
      if (ref !== '' && refExists(ref, cwd)) {
        return ref;
      }
    }
  }

  for (const ref of [
    'origin/develop',
    'origin/main',
    'origin/master',
    'upstream/develop',
    'upstream/main',
    'upstream/master',
    'develop',
    'main',
    'master',
  ]) {
    if (refExists(ref, cwd)) {
      return ref;
    }
  }

  return fail('could not determine a base ref; pass --base REF');
}

function validateWorktreeName(name: string): void {
  if (name === '') {
    fail('missing worktree name');
  }
  if (isAbsolute(name)) {
    fail('worktree name must not be an absolute path');
  }
  if (name.startsWith('.') || name.includes('/.')) {
    fail('worktree name must not contain hidden path components');
  }

  const proc = Bun.spawnSync(['git', 'check-ref-format', '--branch', name], {
    stdout: 'ignore',
    stderr: 'ignore',
  });
  if (proc.exitCode !== 0) {
    fail(`invalid git branch name: ${name}`);
  }
}

function localBranchExists(name: string, cwd = process.cwd()): boolean {
  return refExists(`refs/heads/${name}`, cwd);
}

function generatedWorktreeName(project: string): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = `wt/${randomBytes(2).toString('hex')}`;
    if (!localBranchExists(name) && !existsSync(join(wtWorktreesDir, project, name))) {
      return name;
    }
  }

  return fail('could not generate an available worktree name');
}

function walkManagedWorktrees(scope?: string): string[] {
  const base = scope === undefined ? wtWorktreesDir : join(wtWorktreesDir, scope);
  if (!existsSync(base)) {
    return [];
  }

  const out: string[] = [];
  const stack = [base];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (existsSync(join(current, '.git'))) {
      out.push(current);
      continue;
    }

    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        stack.push(join(current, entry.name));
      }
    }
  }

  return out.toSorted();
}

function worktreeName(path: string, project?: string): string {
  const prefix = project === undefined ? wtWorktreesDir : join(wtWorktreesDir, project);
  return relative(realpathIfExists(prefix), realpathIfExists(path));
}

function worktreeBranch(path: string): string {
  const branch = git(['branch', '--show-current'], path, { allowFail: true });
  if (branch !== '') {
    return branch;
  }

  const commit = git(['rev-parse', '--short', 'HEAD'], path, { allowFail: true });
  return commit === '' ? 'unknown' : commit;
}

function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function realpathIfExists(path: string): string {
  return existsSync(path) ? realpathSync(path) : resolvePath(path);
}

function isSameOrInsideExistingPath(child: string, parent: string): boolean {
  return isPathInside(realpathIfExists(child), realpathIfExists(parent));
}

function archiveTimestamp(): string {
  return new Date().toISOString().slice(0, 19).replaceAll(':', '').replace('T', '-');
}

function archiveDestination(path: string): string {
  const project = projectName(path);
  const managedRoot = join(wtWorktreesDir, project);
  const name = isSameOrInsideExistingPath(path, managedRoot)
    ? worktreeName(path, project).replaceAll('/', '__')
    : path
        .split('/')
        .filter((part) => part !== '')
        .join('__');
  const base = join(wtArchivedDir, project, `${name}-${archiveTimestamp()}`);
  let destination = base;
  for (let suffix = 2; existsSync(destination); suffix++) {
    destination = `${base}-${suffix}`;
  }
  return destination;
}

function managedWorktreeProject(path: string): string | undefined {
  if (!isSameOrInsideExistingPath(path, wtWorktreesDir)) {
    return undefined;
  }

  const [project] = relative(realpathIfExists(wtWorktreesDir), realpathIfExists(path)).split('/');
  return project === undefined || project === '' ? undefined : project;
}

function resolveWorktree(target?: string): string {
  if (target === undefined || target === '') {
    requireGitRepo();
    return repoRoot();
  }

  if (existsSync(target) && lstatSync(target).isDirectory()) {
    return realpathSync(resolvePath(target));
  }

  if (isGitRepo()) {
    const project = projectName();
    const candidate = join(wtWorktreesDir, project, target);
    if (existsSync(candidate)) {
      return realpathSync(candidate);
    }
  }

  const matches = walkManagedWorktrees().filter((path) => {
    const rel = relative(wtWorktreesDir, path);
    const [, ...nameParts] = rel.split('/');
    return nameParts.join('/') === target || rel === target;
  });

  const [match] = matches;
  if (match !== undefined && matches.length === 1) {
    return match;
  }
  if (matches.length === 0) {
    fail(`worktree not found: ${target}`);
  }
  return fail(`multiple worktrees named '${target}'; run from the project repo or pass a path`);
}

function actionsFileForPath(path: string): string {
  return join(baseRepoRoot(path), '.wt', 'actions.json');
}

function readActions(path: string): ActionConfig {
  const file = actionsFileForPath(path);
  if (!existsSync(file)) {
    return {};
  }
  const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (isActionConfig(parsed)) {
    return parsed;
  }
  return fail(`invalid actions.json at ${file}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isActionConfig(value: unknown): value is ActionConfig {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => {
    if (!isRecord(entry)) {
      return false;
    }

    const { command } = entry;
    return command === undefined || typeof command === 'string';
  });
}

function actionNames(path: string): string[] {
  return Object.entries(readActions(path))
    .filter(([, value]) => typeof value.command === 'string' && value.command.length > 0)
    .map(([name]) => name)
    .toSorted();
}

function ellipsis(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 3) {
    return '.'.repeat(maxLength);
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

function actionHint(label: string, command?: string): string | undefined {
  if (command === undefined || command === '') {
    return undefined;
  }

  const columns = process.stdout.columns ?? 80;
  const maxLength = Math.max(12, Math.min(34, columns - label.length - 13));
  return ellipsis(command.replaceAll(/\s+/gu, ' ').trim(), maxLength);
}

function runAction(path: string, action: string): void {
  const file = actionsFileForPath(path);
  const actions = readActions(path);
  const command = actions[action]?.command;
  if (!existsSync(file)) {
    fail(`no actions.json found at ${file}`);
  }
  if (command === undefined || command === '') {
    fail(`action not found or missing command: ${action}`);
  }

  console.log(`${pc.cyan('◆')} ${pc.bold(action)} ${pc.dim(`in ${path}`)}`);
  console.log(`${pc.dim('$')} ${command}`);

  const shell = process.env['SHELL'] ?? '/bin/zsh';
  const proc = Bun.spawnSync([shell, '-lc', command], {
    cwd: path,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (proc.exitCode !== 0) {
    fail(`action '${action}' failed with exit code ${proc.exitCode}`);
  }
}

function runInitIfPresent(path: string): void {
  if (actionNames(path).includes('init')) {
    runAction(path, 'init');
  }
}

async function chooseWorktree(prompt: string, scopeCurrentProject = true): Promise<string> {
  let scope: string | undefined;
  if (scopeCurrentProject && isGitRepo()) {
    scope = projectName();
  }

  const paths = walkManagedWorktrees(scope);
  if (paths.length === 0) {
    fail('no managed worktrees found');
  }

  const selected = await promptSelect(
    prompt,
    paths.map((path) => ({
      value: path,
      label: scope === undefined ? relative(wtWorktreesDir, path) : worktreeName(path, scope),
      hint: worktreeBranch(path),
    })),
  );
  return selected;
}

async function chooseGotoPath(): Promise<string> {
  const options: PromptOption[] = [];
  let scope: string | undefined;
  if (isGitRepo()) {
    scope = projectName();
    const root = baseRepoRoot();
    options.push({ value: root, label: 'root', hint: root });
  }

  options.push(
    ...walkManagedWorktrees(scope).map((path) => ({
      value: path,
      label: scope === undefined ? relative(wtWorktreesDir, path) : worktreeName(path, scope),
      hint: worktreeBranch(path),
    })),
  );

  if (options.length === 0) {
    fail('no repository root or managed worktrees found');
  }

  const selected = await promptSelect('Go to which directory?', options);
  return selected;
}

async function chooseAction(path: string): Promise<string> {
  const names = actionNames(path);
  if (names.length === 0) {
    fail(`no actions found for ${path}`);
  }

  const actions = readActions(path);
  const selected = await promptSelect(
    'Choose an action',
    names.map((name) => {
      const hint = actionHint(name, actions[name]?.command);
      return hint === undefined ? { value: name, label: name } : { value: name, label: name, hint };
    }),
  );
  return selected;
}

async function promptSelectFallback(message: string, options: PromptOption[]): Promise<string> {
  const selected = await select({
    message,
    options,
  });
  if (isCancel(selected)) {
    cancel('cancelled');
    process.exit(1);
  }
  return selected;
}

async function promptSelectOpenTui(message: string, options: PromptOption[]): Promise<string> {
  const {
    BoxRenderable,
    SelectRenderable,
    SelectRenderableEvents,
    TextRenderable,
    createCliRenderer,
  } = await import('@opentui/core');

  const renderer = await createCliRenderer({
    screenMode: 'main-screen',
    consoleMode: 'disabled',
    exitOnCtrlC: false,
    useMouse: false,
    useKittyKeyboard: null,
    clearOnShutdown: true,
    backgroundColor: darkPanel,
  });

  const visibleItems = Math.min(Math.max(options.length, 1), 8);
  const width = Math.min(Math.max(56, renderer.width - 4), 92);
  const height = Math.min(renderer.height - 2, Math.max(8, visibleItems * 2 + 5));
  const panel = new BoxRenderable(renderer, {
    id: 'wt-select-form',
    width,
    height,
    border: true,
    borderStyle: 'rounded',
    borderColor: pinkHex,
    title: ` ${message} `,
    titleColor: pinkHex,
    bottomTitle: ' Enter selects · Esc cancels ',
    backgroundColor: darkPanel,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
  });

  const help = new TextRenderable(renderer, {
    id: 'help',
    content: 'Use ↑/↓ to move. Press Enter to select.',
    fg: mutedText,
    height: 1,
    truncate: true,
  });
  const list = new SelectRenderable(renderer, {
    id: 'select',
    width: '100%',
    height: Math.max(3, height - 5),
    options: options.map((option) => ({
      name: option.label,
      description: option.hint ?? '',
      value: option.value,
    })),
    backgroundColor: darkPanel,
    focusedBackgroundColor: darkPanel,
    textColor: lightText,
    focusedTextColor: lightText,
    selectedBackgroundColor: darkInputFocused,
    selectedTextColor: pinkHex,
    descriptionColor: mutedText,
    selectedDescriptionColor: lightText,
    showDescription: true,
    showScrollIndicator: true,
    wrapSelection: true,
  });

  panel.add(help);
  panel.add(list);
  renderer.root.add(panel);

  return new Promise<string>((resolve, reject) => {
    let done = false;

    const cleanup = () => {
      renderer.keyInput.off('keypress', onKeypress);
      renderer.destroy();
    };

    const finish = () => {
      const option = list.getSelectedOption();
      const value: unknown = option?.value;
      if (typeof value !== 'string') {
        return;
      }

      done = true;
      cleanup();
      resolve(value);
    };

    const onKeypress = (key: KeyEvent) => {
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        done = true;
        cleanup();
        reject(new WtError('cancelled'));
      }
    };

    list.on(SelectRenderableEvents.ITEM_SELECTED, finish);
    renderer.keyInput.on('keypress', onKeypress);

    list.focus();
    renderer.start();
    renderer.requestRender();

    renderer.on('destroy', () => {
      if (!done) {
        reject(new WtError('cancelled'));
      }
    });
  });
}

async function promptSelect(message: string, options: PromptOption[]): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptSelectFallback(message, options);
  }

  try {
    return await promptSelectOpenTui(message, options);
  } catch (error) {
    if (error instanceof WtError) {
      throw error;
    }
    return promptSelectFallback(message, options);
  }
}

async function promptConfirmOpenTui(message: string): Promise<boolean> {
  const selected = await promptSelect(message, [
    { value: 'no', label: 'No', hint: 'Cancel' },
    { value: 'yes', label: 'Yes', hint: 'Continue' },
  ]);
  return selected === 'yes';
}

async function promptConfirmFallback(message: string): Promise<boolean> {
  const ok = await confirm({
    message,
    initialValue: false,
  });
  if (isCancel(ok)) {
    cancel('cancelled');
    process.exit(1);
  }
  return ok;
}

async function promptConfirm(message: string): Promise<boolean> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptConfirmFallback(message);
  }

  try {
    return await promptConfirmOpenTui(message);
  } catch (error) {
    if (error instanceof WtError) {
      throw error;
    }
    return promptConfirmFallback(message);
  }
}

function fetchRemotes(cwd = process.cwd()): void {
  const remotes = git(['remote'], cwd, { allowFail: true });
  if (remotes.trim() === '') {
    return;
  }
  const s = spinner();
  s.start('Fetching remotes');
  const proc = Bun.spawnSync(['git', 'fetch', '--prune', '--all'], {
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (proc.exitCode === 0) {
    s.stop('Fetched remotes');
    return;
  }
  s.stop('Fetch failed');
  const stderr = proc.stderr === undefined ? '' : new TextDecoder().decode(proc.stderr).trim();
  fail(stderr || 'git fetch failed');
}

function requiredText(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === '') {
    return 'Enter a command';
  }
  return undefined;
}

async function promptCommand(
  message: string,
  placeholder: string,
  initialValue?: string,
): Promise<string> {
  const options = {
    message,
    placeholder,
    validate: requiredText,
    ...(initialValue === undefined ? {} : { initialValue }),
  };
  const value = await text(options);

  if (isCancel(value)) {
    cancel('cancelled');
    process.exit(1);
  }

  return value.trim();
}

async function promptInitCommandsFallback(existing: ActionConfig): Promise<InitCommands> {
  intro('wt init');
  const initCommand = await promptCommand(
    'Init command',
    defaultInitCommand,
    existing['init']?.command,
  );
  const runCommand = await promptCommand(
    'Run command',
    defaultRunCommand,
    existing['run']?.command,
  );
  return { initCommand, runCommand };
}

async function promptInitCommandsOpenTui(existing: ActionConfig): Promise<InitCommands> {
  const {
    BoxRenderable,
    InputRenderable,
    InputRenderableEvents,
    TextRenderable,
    createCliRenderer,
  } = await import('@opentui/core');

  const renderer = await createCliRenderer({
    screenMode: 'main-screen',
    consoleMode: 'disabled',
    exitOnCtrlC: false,
    useMouse: false,
    useKittyKeyboard: null,
    clearOnShutdown: true,
    backgroundColor: darkPanel,
  });

  const width = Math.min(Math.max(64, renderer.width - 4), 94);
  const inputWidth = Math.max(32, width - 18);
  const panel = new BoxRenderable(renderer, {
    id: 'wt-init-form',
    width,
    height: 11,
    border: true,
    borderStyle: 'rounded',
    borderColor: pinkHex,
    title: ' wt init ',
    titleColor: pinkHex,
    bottomTitle: ' Esc cancels ',
    backgroundColor: darkPanel,
    padding: 1,
    flexDirection: 'column',
    gap: 1,
  });

  const help = new TextRenderable(renderer, {
    id: 'help',
    content: 'Edit local worktree actions. Tab switches fields. Enter saves from Run.',
    fg: mutedText,
    height: 1,
    truncate: true,
  });
  const error = new TextRenderable(renderer, {
    id: 'error',
    content: '',
    fg: '#FCA5A5',
    height: 1,
    truncate: true,
  });

  function labeledInput(id: string, label: string, value: string | undefined, placeholder: string) {
    const row = new BoxRenderable(renderer, {
      id: `${id}-row`,
      width: '100%',
      height: 1,
      flexDirection: 'row',
      gap: 1,
    });
    row.add(
      new TextRenderable(renderer, {
        id: `${id}-label`,
        content: label.padEnd(11),
        fg: mutedText,
        width: 12,
        height: 1,
      }),
    );
    const input = new InputRenderable(renderer, {
      id,
      width: inputWidth,
      value: value ?? '',
      placeholder,
      minLength: 1,
      maxLength: 500,
      backgroundColor: darkInput,
      focusedBackgroundColor: darkInputFocused,
      textColor: lightText,
      focusedTextColor: lightText,
      placeholderColor: mutedText,
      cursorColor: pinkHex,
    });
    row.add(input);
    return { row, input };
  }

  const init = labeledInput('init-command', 'Init', existing['init']?.command, defaultInitCommand);
  const run = labeledInput('run-command', 'Run', existing['run']?.command, defaultRunCommand);

  panel.add(help);
  panel.add(init.row);
  panel.add(run.row);
  panel.add(error);
  renderer.root.add(panel);

  const inputs = [init.input, run.input];
  let focusIndex = 0;

  const setFocus = (index: number) => {
    inputs[focusIndex]?.blur();
    focusIndex = index;
    inputs[focusIndex]?.focus();
    renderer.requestRender();
  };

  const setError = (message: string) => {
    error.content = message;
    renderer.requestRender();
  };

  return new Promise<InitCommands>((resolve, reject) => {
    let done = false;

    const cleanup = () => {
      renderer.keyInput.off('keypress', onKeypress);
      renderer.destroy();
    };

    const finish = () => {
      const initCommand = init.input.value.trim();
      const runCommand = run.input.value.trim();
      if (initCommand === '') {
        setError('Init command is required.');
        setFocus(0);
        return;
      }
      if (runCommand === '') {
        setError('Run command is required.');
        setFocus(1);
        return;
      }

      done = true;
      cleanup();
      resolve({ initCommand, runCommand });
    };

    const onKeypress = (key: KeyEvent) => {
      if (key.name === 'tab') {
        key.preventDefault();
        setError('');
        setFocus((focusIndex + 1) % inputs.length);
        return;
      }
      if (key.name === 'escape' || (key.ctrl && key.name === 'c')) {
        done = true;
        cleanup();
        reject(new WtError('cancelled'));
      }
    };

    init.input.on(InputRenderableEvents.ENTER, () => {
      setError('');
      setFocus(1);
    });
    run.input.on(InputRenderableEvents.ENTER, finish);
    renderer.keyInput.on('keypress', onKeypress);

    setFocus(0);
    renderer.start();
    renderer.requestRender();

    renderer.on('destroy', () => {
      if (!done) {
        reject(new WtError('cancelled'));
      }
    });
  });
}

async function promptInitCommands(existing: ActionConfig): Promise<InitCommands> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return promptInitCommandsFallback(existing);
  }

  try {
    return await promptInitCommandsOpenTui(existing);
  } catch (error) {
    if (error instanceof WtError) {
      throw error;
    }
    return promptInitCommandsFallback(existing);
  }
}

async function cmdInit(args: string[]): Promise<void> {
  requireGitRepo();

  if (args.length > 0) {
    if (args.length === 1 && (args[0] === '-h' || args[0] === '--help')) {
      console.log(usage());
      return;
    }
    fail(`unknown option for init: ${args[0]}`);
  }

  const root = baseRepoRoot();
  const wtDir = join(root, '.wt');
  const ignoreFile = join(wtDir, '.gitignore');
  const actionsFile = join(wtDir, 'actions.json');
  let existing: ActionConfig = {};
  if (existsSync(actionsFile)) {
    try {
      existing = readActions(root);
    } catch {
      existing = {};
    }
  }

  const { initCommand, runCommand } = await promptInitCommands(existing);
  const actions: ActionConfig = {
    init: { command: initCommand },
    run: { command: runCommand },
  };

  mkdirSync(wtDir, { recursive: true });
  if (!existsSync(ignoreFile)) {
    writeFileSync(ignoreFile, '*\n');
  }
  writeFileSync(actionsFile, `${JSON.stringify(actions, null, 2)}\n`);

  console.log(`${pc.green('created')} ${relative(root, actionsFile)} ${pc.dim(`in ${root}`)}`);
}

function cmdNew(args: string[]): void {
  requireGitRepo();
  let base = '';
  let doFetch = true;
  let name = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--base') {
      base = args[++i] ?? fail('--base requires a value');
    } else if (arg.startsWith('--base=')) {
      base = arg.slice('--base='.length);
    } else if (arg === '--no-fetch') {
      doFetch = false;
    } else if (arg === '-h' || arg === '--help') {
      console.log(usage());
      return;
    } else if (arg.startsWith('-')) {
      fail(`unknown option for new: ${arg}`);
    } else if (name === '') {
      name = arg;
    } else {
      fail('new accepts one NAME');
    }
  }

  if (doFetch) {
    fetchRemotes();
  }
  if (base === '') {
    base = defaultBaseRef();
  }

  const project = projectName();
  if (name === '') {
    name = generatedWorktreeName(project);
  }
  validateWorktreeName(name);

  const target = join(wtWorktreesDir, project, name);
  if (existsSync(target)) {
    fail(`target already exists: ${target}`);
  }

  mkdirSync(dirname(target), { recursive: true });
  const branchExists = localBranchExists(name);

  intro(`wt new ${name}`);
  const gitArgs = branchExists
    ? ['worktree', 'add', target, name]
    : ['worktree', 'add', '-b', name, target, base];
  git(gitArgs, process.cwd(), { inherit: true });
  runInitIfPresent(target);
  outro(`${pc.green('created')} ${target}`);
}

function cmdList(args: string[]): void {
  const all = args.includes('--all') || args.includes('-a');
  if (args.some((arg) => !['--all', '-a'].includes(arg))) {
    fail(`unknown option for list: ${args.find((arg) => !['--all', '-a'].includes(arg))}`);
  }

  const scope = !all && isGitRepo() ? projectName() : undefined;
  const paths = walkManagedWorktrees(scope);

  console.log(helpSection('Worktrees'));
  if (paths.length === 0) {
    console.log(`  ${muted('No managed worktrees found.')}`);
    return;
  }

  for (const path of paths) {
    const rel = relative(wtWorktreesDir, path);
    const [project = 'unknown', ...nameParts] = rel.split('/');
    const name = nameParts.join('/');
    console.log(`  ${pink('◆')} ${bold(project)} ${pink(name)} ${muted(worktreeBranch(path))}`);
    console.log(`    ${muted(path)}`);
  }
}

async function cmdGoto(args: string[]): Promise<void> {
  if (args.length > 1) {
    fail('goto accepts at most one NAME or PATH');
  }
  let path: string;
  if (args[0] === undefined) {
    path = await chooseGotoPath();
  } else if (args[0] === 'root') {
    requireGitRepo();
    path = baseRepoRoot();
  } else {
    path = resolveWorktree(args[0]);
  }
  const outputFile = process.env['WT_GOTO_OUTPUT'];
  if (outputFile !== undefined && outputFile !== '') {
    writeFileSync(outputFile, `${path}\n`);
    return;
  }
  console.log(path);
  printGotoShellHint();
}

function printGotoShellHint(): void {
  if (!process.stdout.isTTY || !process.stderr.isTTY) {
    return;
  }

  console.error(
    `${muted('tip')} run ${pink('eval "$(wt shell-init)"')} to make ${pink('wt goto')} change this shell directory`,
  );
}

function cmdShellInit(args: string[]): void {
  if (args.length > 0) {
    fail(`unknown option for shell-init: ${args[0]}`);
  }

  const wtBin = shellQuote(shellInitExecutablePath());
  console.log(`_wt_bin=${wtBin}
wt() {
  if [ "$1" = "goto" ]; then
    shift
    local tmp
    local dir
    tmp="$(mktemp)" || return
    env WT_GOTO_OUTPUT="$tmp" "$_wt_bin" goto "$@" || {
      rm -f "$tmp"
      return
    }
    dir="$(cat "$tmp")"
    rm -f "$tmp"
    [ -n "$dir" ] || return
    cd "$dir" || return
  else
    "$_wt_bin" "$@"
  fi
}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function shellInitExecutablePath(): string {
  const [, scriptPath] = process.argv;
  if (scriptPath === undefined || scriptPath.startsWith('/$bunfs/')) {
    return process.execPath;
  }
  return scriptPath;
}

async function cmdOpen(args: string[]): Promise<void> {
  if (args.length > 1) {
    fail('open accepts at most one NAME or PATH');
  }
  const path =
    args[0] === undefined ? await chooseWorktree('Open which worktree?') : resolveWorktree(args[0]);

  const cursor = Bun.which('cursor');
  if (cursor !== null && cursor !== undefined) {
    runBin(cursor, [path], { inherit: true });
  } else if (existsSync('/Applications/Cursor.app')) {
    runBin('open', ['-a', 'Cursor', path], { inherit: true });
  } else {
    fail('Cursor CLI not found and /Applications/Cursor.app does not exist');
  }

  console.log(`${pc.green('opened')} ${path}`);
}

async function cmdRun(args: string[]): Promise<void> {
  let path: string;
  let action: string;

  if (args.length === 0) {
    path = isGitRepo() ? repoRoot() : await chooseWorktree('Run action in which worktree?', false);
    action = await chooseAction(path);
  } else if (args.length === 1) {
    if (isGitRepo() && actionNames(repoRoot()).includes(args[0]!)) {
      path = repoRoot();
      action = args[0]!;
    } else {
      path = resolveWorktree(args[0]);
      action = await chooseAction(path);
    }
  } else if (args.length === 2) {
    path = resolveWorktree(args[0]);
    action = args[1]!;
  } else {
    fail('run requires ACTION or NAME ACTION');
  }

  runAction(path, action);
}

function cmdRename(args: string[]): void {
  if (args.length !== 2) {
    fail('rename requires NAME|PATH and NEW_NAME');
  }

  const [target, newName] = args;
  if (target === undefined || newName === undefined) {
    fail('rename requires NAME|PATH and NEW_NAME');
  }
  validateWorktreeName(newName);

  const path = resolveWorktree(target);
  const root = baseRepoRoot(path);
  if (repoRoot(path) === root) {
    fail('cannot rename the main worktree');
  }

  const project = managedWorktreeProject(path);
  if (project === undefined) {
    fail(`not a managed worktree: ${path}`);
  }

  const destination = join(wtWorktreesDir, project, newName);
  if (path === resolvePath(destination)) {
    fail(`worktree is already named ${newName}`);
  }
  if (existsSync(destination)) {
    fail(`target already exists: ${destination}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  git(['worktree', 'move', path, destination], root);
  console.log(`${pc.green('renamed')} ${worktreeName(path, project)} ${pc.dim('->')} ${newName}`);
  console.log(`  ${muted(destination)}`);
}

async function cmdArchive(args: string[]): Promise<void> {
  let force = false;
  let target = '';
  for (const arg of args) {
    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg.startsWith('-')) {
      fail(`unknown option for archive: ${arg}`);
    } else if (target === '') {
      target = arg;
    } else {
      fail('archive accepts one NAME or PATH');
    }
  }

  const path =
    target === '' ? await chooseWorktree('Archive which worktree?') : resolveWorktree(target);
  const root = baseRepoRoot(path);
  if (repoRoot(path) === root) {
    fail('cannot archive the main worktree');
  }
  if (!force) {
    const ok = await promptConfirm(`Archive ${worktreeName(path, projectName(path))}?`);
    if (!ok) {
      cancel('cancelled');
      process.exit(1);
    }
  }

  const destination = archiveDestination(path);
  mkdirSync(dirname(destination), { recursive: true });
  git(['worktree', 'unlock', path], root, { allowFail: true });
  renameSync(path, destination);
  try {
    git(['worktree', 'prune', '--expire', 'now'], root);
  } catch (error) {
    renameSync(destination, path);
    throw error;
  }
  console.log(`${pc.green('archived')} ${path}`);
  console.log(`  ${muted('moved to')} ${destination}`);
}

function completeWorktrees(): void {
  const scope = isGitRepo() ? projectName() : undefined;
  for (const path of walkManagedWorktrees(scope)) {
    console.log(scope === undefined ? relative(wtWorktreesDir, path) : worktreeName(path, scope));
  }
}

function completeRefs(): void {
  const refs = git(
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
    process.cwd(),
    {
      allowFail: true,
    },
  );
  for (const ref of refs.split('\n').filter((line) => line !== '' && !line.endsWith('/HEAD'))) {
    console.log(ref);
  }
}

function completeActions(target?: string): void {
  let path: string | undefined;
  try {
    if (target !== undefined && target !== '') {
      path = resolveWorktree(target);
    } else if (isGitRepo()) {
      path = repoRoot();
    }
  } catch {
    return;
  }
  if (path === undefined || path === '') {
    return;
  }
  for (const name of actionNames(path)) {
    console.log(name);
  }
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  if (cmd === undefined || cmd === '') {
    console.log(usage());
    return;
  }
  const normalizedCmd = commandAliases[cmd] ?? cmd;

  switch (normalizedCmd) {
    case 'init': {
      await cmdInit(args);
      break;
    }
    case 'new': {
      cmdNew(args);
      break;
    }
    case 'list': {
      cmdList(args);
      break;
    }
    case 'open': {
      await cmdOpen(args);
      break;
    }
    case 'goto': {
      await cmdGoto(args);
      break;
    }
    case 'shell-init': {
      cmdShellInit(args);
      break;
    }
    case 'run': {
      await cmdRun(args);
      break;
    }
    case 'rename': {
      cmdRename(args);
      break;
    }
    case 'archive': {
      await cmdArchive(args);
      break;
    }
    case '__complete-worktrees': {
      completeWorktrees();
      break;
    }
    case '__complete-refs': {
      completeRefs();
      break;
    }
    case '__complete-actions': {
      completeActions(args[0]);
      break;
    }
    case 'help': {
      console.log(usage());
      break;
    }
    default: {
      fail(`unknown command: ${cmd}`);
    }
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof WtError) {
    console.error(`${pc.red('wt:')} ${error.message}`);
    process.exit(1);
  }
  throw error;
}
