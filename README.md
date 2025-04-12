# npm-project-mcp
This tool allows you to build and run Node projects.
# Build
```
npm install
npm run build
```
# Configure
Add the following to the MCP configuration file:
```
"npm-project": {
    "command": "node",
    "args": ["<absolute path>node-exec-mcp/build/index.js"]
}
```
