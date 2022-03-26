# Typescript plugin template for TiddlyWiki5

This template will help you automatically package zipped multiple-file plugin for nodejs wiki, and single file JSON plugin for HTML wiki.

## What need to change after apply the template

### Basic

1. update `title`, `author` and `description` in the [src/plugin.info](src/plugin.info), update `url` field in the [package.json](package.json).
1. write your plugin code in the [src/](src/) directory, use `index.ts` as your ts code's entry point.
1. other tid files just put in the src directory, they will be copy to the plugin automatically.
   1. You can use folder to organize the files, like `src/filters/` to place the filter tiddlers, and that structure will be preserved in the nodejs multiple-file plugin
   1. In the JSON plugin, the structure will strictly follow the tiddler title.
1. update demo site tiddlers in the [demo/](demo/) directory.
1. update this readme.md

## During development

There are some scripts you can run to boost your development.

After `npm i`:

- `npm run dev-demo` to setup the demo site locally. Re-run this command and refresh browser to see changes to local code and tiddlers.
- `npm run dev` to pack the plugin in the `dist/` directory.

### Add a second ts file

Add new file name (without `.ts`) to `package.json`'s `tsFiles` field. And build script will read it and compile files in it.

## After the plugin is complete

### Publish

Enable github action in your repo (in your github repo - setting - action - general) if it is not allowed, and when you tagging a new version `vx.x.x` in a git commit and push, it will automatically publish to the github release.

### Demo

You will get a Github Pages demo site automatically after publish. If it is 404, you may need to manually enable Github Pages in your github repo:

Settings - Pages (on left side) - Source - choose `gh-pages` branch

## Examples

- https://github.com/tiddly-gittly/tw-react
- https://github.com/tiddly-gittly/slate-write
