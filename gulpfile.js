const path = require('path');
const { task, src, dest } = require('gulp');

task('build:icons', copyIcons);

function copyIcons() {
	// The codex file (*.node.json) travels with the node, so it is copied here
	// too rather than in a separate task.
	const nodeSource = path.resolve('nodes', '**', '*.{png,svg,node.json}');
	const nodeDestination = path.resolve('dist', 'nodes');

	return src(nodeSource, { encoding: false }).pipe(dest(nodeDestination));
}
