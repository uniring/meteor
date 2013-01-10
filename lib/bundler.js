// Bundle contents:
// main.js [run to start the server]
// /static [served by node for now]
// /static_cacheable [cache-forever files, served by node for now]
// /server
//   server.js, db.js, .... [contents of app/server]
//   node_modules [for now, contents of (meteor_root)/lib/node_modules]
// /app.html
// /app [user code]
// /app.json: [data for server.js]
//  - load [list of files to load, relative to root, presumably under /app]
// /dependencies.json: files to monitor for changes in development mode
//  - extensions [list of extensions registered for user code, with dots]
//  - packages [map from package name to list of paths relative to the package]
//  - core [paths relative to 'app' in meteor tree]
//  - app [paths relative to top of app tree]
//  - exclude [list of regexps for files to ignore (everywhere)]
//  (for 'core' and 'apps', if a directory is given, you should
//  monitor everything in the subtree under it minus the stuff that
//  matches exclude, and if it doesn't exist yet, you should watch for
//  it to appear)
//
// The application launcher is expected to execute /main.js with node, setting
// various environment variables (such as PORT and MONGO_URL). The enclosed node
// application is expected to do the rest, including serving /static.

var path = require('path');
var files = require(path.join(__dirname, 'files.js'));
var packages = require(path.join(__dirname, 'packages.js'));
var crypto = require('crypto');
var fs = require('fs');
var uglify = require('uglify-js');
var cleanCSS = require('clean-css');
var _ = require('underscore');
var project = require(path.join(__dirname, 'project.js'));

// files to ignore when bundling. node has no globs, so use regexps
var ignore_files = [
    /~$/, /^\.#/, /^#.*#$/,
    /^\.DS_Store$/, /^ehthumbs\.db$/, /^Icon.$/, /^Thumbs\.db$/,
    /^\.meteor$/, /* avoids scanning N^2 files when bundling all packages */
    /^\.git$/ /* often has too many files to watch */
];

///////////////////////////////////////////////////////////////////////////////
// PackageInstance
///////////////////////////////////////////////////////////////////////////////

// Represents the occurrence of a package in a bundle
var PackageInstance = function (pkg, bundle) {
  var self = this;
  self.pkg = pkg;
  self.bundle = bundle;

  // list of places we've already been used. map from a 'canonicalized
  // where' to true. 'canonicalized where' is the JSONification of a
  // sorted array with zero or more elements drawn from the set
  // 'client', 'server', with each element unique
  // XXX this is a mess, refactor
  self.where = {};

  // other packages we've used (with any 'where') -- map from id to package
  self.using = {};

  // map from where (client, server) to a source file name (relative
  // to the package) to true
  self.files = {client: {}, server: {}};

  // files we depend on -- map from rel_path to true
  self.dependencies = {};
  if (pkg.name)
    self.dependencies['package.js'] = true;

  // the API available from on_use / on_test handlers
  self.api = {
    // Called when this package wants to make another package be
    // used. Can also take literal package objects, if you have
    // anonymous packages you want to use (eg, app packages)
    use: function (names, where) {
      if (!(names instanceof Array))
        names = names ? [names] : [];

      _.each(names, function (name) {
        var pkg = packages.get(self.bundle.manifest, name);
        if (!pkg)
          throw new Error("Package not found: " + name);
        self.bundle.use(pkg, where, self);
      });
    },

    // xcxc
    // npmDependencies eg {gcd: "0.0.0", tar: "0.1.14"}
    useNpm: function (npmDependencies) {
      // xcxc assert that all dependencies are exact versions

      var exec = require('child_process').exec;
      var Future = require('fibers/future');

      // a variant of exec that can be used with `Future.wrap`
      var exec2 = function(cmd, cb) {
        exec(cmd, function (err, stdout, stderr) {
          cb(err, {stdout: stdout, stderr: stderr});
        });
      };
      var execSync = function(cmd) {
        return Future.wrap(exec2)(cmd).wait();
      };

      // xcxc remove this prior to supporting incremental changes
      var npmDir = path.join(self.pkg.source_root, '.npm');
      files.rm_recursive(npmDir);

      var packageJsonContents = JSON.stringify({
        // name and version are unimportant but required for `npm install`
        name: 'npm-packages-for-meteor-package-' + self.pkg.name,
        version: '0.0.0',
        dependencies: npmDependencies
      });

      files.mkdir_p(npmDir);
      fs.writeFileSync(path.join(npmDir, 'package.json'), packageJsonContents);

      // xcxc run npm correctly... how?
      console.log('npm results', execSync("cd " + npmDir + " && ~/meteor/dev_bundle/bin/npm install && ~/meteor/dev_bundle/bin/npm shrinkwrap"));

      // PSEUDO-CODE:
      // if there is no self.pkg.source_root/npm:
      // 1. print a message explaining what is happening to the user
      // 2. generate source_root/npm/package.json with a dummy name and version,
      //    and dependencies as passed in the argument
      // 3. cd npm && npm install && npm shrinkwrap
      //
      // if there is a directory source_root/npm:
      // 1. make sure npm-shrinkwrap.json exists, else choke (xcxc?)
      // 2. check if dependencies in npm/package.json correspond to the
      //    dependencies argument. if they are the same, we're done
      // 3. otherwise, diff the old and new dependencies. for each package,
      // see npm shrinkwrap comments:
      //   To add or update a dependency in a shrinkwrapped package:
      //
      //   1. Run "npm install" in the package root to install the
      //   current versions of all dependencies.  2. Add or update
      //   dependencies. "npm install" each new or updated package
      //   individually and then update package.json. Note that they
      //   must be explicitly named in order to be installed: running
      //   npm install with no arguments will merely reproduce the
      //   existing shrinkwrap.  3. Validate that the package works as
      //   expected with the new dependencies.  4. Run "npm shrinkwrap",
      //   commit the new npm-shrinkwrap.json, and publish your
      //   package.  You can use outdated(1) to view dependencies with
      //   newer versions available.
      //
      // 3.1. if it is new, call `npm install foo@version` and update package.json
      // 3.2. if it was removed, `npm uninstall foo@version` and update package.json
      // 3.3. if its version changed, `npm install foo@newversion` and update package.json
      // (xcxc does this sound a little complicated?)
      // 4. run `npm shrinkwrap`
      //
      // NOTES:
      // 1. need to ensure node_modules is in .gitignore
      // 2. npm/package.json (maybe) and npm/npm-shrinkwrap.json will be in git
      // QUESTION: should npm/package.json actually *not* be in git?

      return;
      handler(self.bundle.api,
              path.join(self.pkg.source_root, rel_path),
              path.join(self.pkg.serve_root, rel_path),
              where);

      bundle.add_resource({
        type: "js",
        path: serve_path,
        source_file: source_path,
        where: where
      });
    },

    add_files: function (paths, where) {
      if (!(paths instanceof Array))
        paths = paths ? [paths] : [];
      if (!(where instanceof Array))
        where = where ? [where] : [];

      _.each(where, function (w) {
        _.each(paths, function (rel_path) {
          self.add_file(rel_path, w);
        });
      });
    },

    // Return a list of all of the extension that indicate source files
    // inside this package, INCLUDING leading dots.
    registered_extensions: function () {
      var ret = _.keys(self.pkg.extensions);

      for (var id in self.using) {
        var other_inst = self.using[id];
        ret = _.union(ret, _.keys(other_inst.pkg.extensions));
      }

      return _.map(ret, function (x) {return "." + x;});
    },

    // Report an error. It should be a single human-readable
    // string. If any errors are reported, the bundling is considered
    // to have failed.
    error: function (message) {
      self.bundle.errors.push(message);
    }
  };

  if (pkg.name !== "meteor")
    self.api.use("meteor");
};

_.extend(PackageInstance.prototype, {
  // Find the function that should be used to handle a source file
  // found in this package. We'll use handlers that are defined in
  // this package and in its immediate dependencies. ('extension'
  // should be the extension of the file without a leading dot.)
  get_source_handler: function (extension) {
    var self = this;
    var candidates = [];

    if (extension in self.pkg.extensions)
      candidates.push(self.pkg.extensions[extension]);

    for (var id in self.using) {
      var other_inst = self.using[id];
      var other_pkg = other_inst.pkg;
      if (extension in other_pkg.extensions)
        candidates.push(other_pkg.extensions[extension]);
    }

    // XXX do something more graceful than printing a stack trace and
    // exiting!! we have higher standards than that!

    if (!candidates.length)
      return null;

    if (candidates.length > 1)
      // XXX improve error message (eg, name the packages involved)
      // and make it clear that it's not a global conflict, but just
      // among this package's dependencies
      throw new Error("Conflict: two packages are both trying " +
                      "to handle ." + extension);

    return candidates[0];
  },

  add_file: function (rel_path, where) {
    var self = this;

    if (self.files[where][rel_path])
      return;
    self.files[where][rel_path] = true;

    var ext = path.extname(rel_path).substr(1);
    var handler = self.get_source_handler(ext);
    if (!handler) {
      // If we don't have an extension handler, serve this file
      // as a static resource.
      self.bundle.api.add_resource({
        type: "static",
        path: path.join(self.pkg.serve_root, rel_path),
        data: fs.readFileSync(path.join(self.pkg.source_root, rel_path)),
        where: where
      });
      return;
    }

    handler(self.bundle.api,
            path.join(self.pkg.source_root, rel_path),
            path.join(self.pkg.serve_root, rel_path),
            where);

    self.dependencies[rel_path] = true;
  }
});

///////////////////////////////////////////////////////////////////////////////
// Bundle
///////////////////////////////////////////////////////////////////////////////

var Bundle = function () {
  var self = this;

  // Packages being used. Map from a package id to a PackageInstance.
  self.packages = {};

  // Packages that have had tests included. Map from package id to instance
  self.tests_included = {};

  // release manifest
  self.manifest = null;

  // map from environment, to list of filenames
  self.js = {client: [], server: []};

  // list of filenames
  self.css = [];

  // Map from environment, to path name (server relative), to contents
  // of file as buffer.
  self.files = {client: {}, client_cacheable: {}, server: {}};

  // list of segments of additional HTML for <head>/<body>
  self.head = [];
  self.body = [];

  // list of errors encountered while bundling. array of string.
  self.errors = [];

  // the API available from register_extension handlers
  self.api = {
    /**
     * This is the ultimate low-level API to add data to the bundle.
     *
     * type: "js", "css", "head", "body", "static"
     *
     * where: an environment, or a list of one or more environments
     * ("client", "server", "tests") -- for non-JS resources, the only
     * legal environment is "client"
     *
     * path: the (absolute) path at which the file will be
     * served. ignored in the case of "head" and "body".
     *
     * source_file: the absolute path to read the data from. if path
     * is set, will default based on that. overridden by data.
     *
     * data: the data to send. overrides source_file if present. you
     * must still set path (except for "head" and "body".)
     */
    add_resource: function (options) {
      var source_file = options.source_file || options.path;

      var data = options.data;
      if (options.data) {
        var data = options.data;
        if (!(data instanceof Buffer)) {
          if (!(typeof data === "string"))
            throw new Error("Bad type for data");
          data = new Buffer(data, 'utf8');
        }
      } else {
        if (!source_file)
          throw new Error("Need either source_file or data");
        var data = fs.readFileSync(source_file);
      }

      var where = options.where;
      if (typeof where === "string")
        where = [where];
      if (!where)
        throw new Error("Must specify where");

      _.each(where, function (w) {
        if (options.type === "js") {
          if (!options.path)
            throw new Error("Must specify path");

          if (w === "client" || w === "server") {
            self.files[w][options.path] = data;
            self.js[w].push(options.path);
          } else {
            throw new Error("Invalid environment");
          }
        } else if (options.type === "css") {
          if (w !== "client")
            // XXX might be nice to throw an error here, but then we'd
            // have to make it so that packages.js ignores css files
            // that appear in the server directories in an app tree
            return;
          if (!options.path)
            throw new Error("Must specify path");
          self.files.client[options.path] = data;
          self.css.push(options.path);
        } else if (options.type === "head" || options.type === "body") {
          if (w !== "client")
            throw new Error("HTML segments can only go to the client");
          self[options.type].push(data);
        } else if (options.type === "static") {
          self.files[w][options.path] = data;
        } else {
          throw new Error("Unknown type " + options.type);
        }
      });
    },

    // Report an error. It should be a single human-readable
    // string. If any errors are reported, the bundling is considered
    // to have failed.
    error: function (message) {
      self.errors.push(message);
    }
  };
};

_.extend(Bundle.prototype, {
  _get_instance: function (pkg) {
    var self = this;

    var inst = self.packages[pkg.id];
    if (!inst) {
      inst = new PackageInstance(pkg, self);
      self.packages[pkg.id] = inst;
    }

    return inst;
  },

  // Call to add a package to this bundle
  // if 'where' is given, it's an array of "client" and/or "server"
  // if 'from' is given, it's the PackageInstance that's doing the
  // using, or it can be undefined for top level
  use: function (pkg, where, from) {
    var self = this;
    var inst = self._get_instance(pkg);

    if (from)
      from.using[pkg.id] = inst;
    
    // get 'canonicalized where'
    var canon_where = where;
    if (!canon_where)
      canon_where = [];
    if (!(canon_where instanceof Array))
      canon_where = [canon_where];
    else
      canon_where = _.clone(canon_where);
    canon_where.sort();
    canon_where = JSON.stringify(canon_where);

    if (inst.where[canon_where])
      return; // already used in this environment
    inst.where[canon_where] = true;

    // XXX detect circular dependencies and print an error. (not sure
    // what the current code will do)

    if (pkg.on_use_handler)
      pkg.on_use_handler(inst.api, where);
  },

  includeTests: function (packageName) {
    var self = this;
    var pkg = packages.get(self.manifest, packageName);
    if (self.tests_included[pkg.id])
      return;
    self.tests_included[pkg.id] = true;

    var inst = self._get_instance(pkg);
    if (inst.pkg.on_test_handler)
      inst.pkg.on_test_handler(inst.api);
  },

  // Minify the bundle
  minify: function () {
    var self = this;

    /// Javascript
    var code_parts = [];

    _.each(self.js.client, function (js_path) {
      var code = self.files.client[js_path].toString('utf8');

      // Uglify has a bug -- it will incorrectly minifiy files that
      // contain the 'debugger' statement.
      // https://github.com/mishoo/UglifyJS/issues/243
      // For now, just skip minification of such files.
      // XXX fix uglify, and once that happens, go back to
      // concatenating before minifying, rather than vice versa
      // https://app.asana.com/0/159908330244/522242142181
      if (!(code.match(/debugger/))) {
        var ast = uglify.parser.parse(code);
        ast = uglify.uglify.ast_mangle(ast);
        ast = uglify.uglify.ast_squeeze(ast);
        code = uglify.uglify.gen_code(ast);
      }

      code_parts.push(code);
      delete self.files.client[js_path];
    });
    var final_code = code_parts.join('\n;\n');

    var hash = crypto.createHash('sha1');
    hash.update(final_code);
    var digest = hash.digest('hex');
    var name = path.sep + digest + ".js";

    self.files.client_cacheable[name] = new Buffer(final_code);
    self.js.client = [name];

    /// CSS
    var css_concat = "";
    _.each(self.css, function (css_path) {
      var css_data = self.files.client[css_path];
      css_concat = css_concat + "\n" +  css_data.toString('utf8');

      delete self.files.client[css_path];
    });

    var final_css = cleanCSS.process(css_concat);

    hash = crypto.createHash('sha1');
    hash.update(final_css);
    digest = hash.digest('hex');
    name = path.sep + digest + ".css";

    self.files.client_cacheable[name] = new Buffer(final_css);
    self.css = [name];
  },

  _generate_app_html: function () {
    var self = this;

    var template = fs.readFileSync(path.join(__dirname, "app.html.in"));
    var f = require('handlebars').compile(template.toString());
    return f({
      scripts: self.js.client,
      head_extra: self.head.join('\n'),
      body_extra: self.body.join('\n'),
      stylesheets: self.css
    });
  },

  // The extensions registered by the application package, if
  // any. Kind of a hack.
  _app_extensions: function () {
    var self = this;
    var exts = {};

    for (var id in self.packages) {
      var inst = self.packages[id];
      if (!inst.name)
        _.each(inst.api.registered_extensions(), function (ext) {
          exts[ext] = true;
        });
    }

    return _.keys(exts);
  },

  // dev_bundle_mode should be "skip", "symlink", or "copy"
  write_to_directory: function (output_path, project_dir, dev_bundle_mode) {
    var self = this;
    var app_json = {};
    var dependencies_json = {core: [], app: [], packages: {}};
    var is_app = files.is_app_dir(project_dir);

    if (is_app) {
      dependencies_json.app.push(path.join('.meteor', 'packages'));
      dependencies_json.app.push(path.join('.meteor', 'version'));
    }

    // --- Set up build area ---

    // foo/bar => foo/.build.bar
    var build_path = path.join(path.dirname(output_path),
                               '.build.' + path.basename(output_path));

    // XXX cleaner error handling. don't make the humans read an
    // exception (and, make suitable for use in automated systems)
    files.rm_recursive(build_path);
    files.mkdir_p(build_path, 0755);

    // --- Core runner code ---

    files.cp_r(path.join(__dirname, '..', 'server'),
               path.join(build_path, 'server'), {ignore: ignore_files});
    dependencies_json.core.push('server');

    // --- Third party dependencies ---

    if (dev_bundle_mode === "symlink")
      fs.symlinkSync(path.join(files.get_dev_bundle(), 'lib', 'node_modules'),
                     path.join(build_path, 'server', 'node_modules'));
    else if (dev_bundle_mode === "copy")
      files.cp_r(path.join(files.get_dev_bundle(), 'lib', 'node_modules'),
                 path.join(build_path, 'server', 'node_modules'),
                 {ignore: ignore_files});
    else
      /* dev_bundle_mode === "skip" */;

    fs.writeFileSync(
      path.join(build_path, 'server', '.bundle_version.txt'),
      fs.readFileSync(
        path.join(files.get_dev_bundle(), '.bundle_version.txt')));

    // --- Static assets ---

    if (is_app) {
      if (fs.existsSync(path.join(project_dir, 'public'))) {
        files.cp_r(path.join(project_dir, 'public'),
                   path.join(build_path, 'static'), {ignore: ignore_files});
      }
      dependencies_json.app.push('public');
    }

    // -- Client code --
    for (var rel_path in self.files.client) {
      var full_path = path.join(build_path, 'static', rel_path);
      files.mkdir_p(path.dirname(full_path), 0755);
      fs.writeFileSync(full_path, self.files.client[rel_path]);
    }

    // -- Client cache forever code --
    for (var rel_path in self.files.client_cacheable) {
      var full_path = path.join(build_path, 'static_cacheable', rel_path);
      files.mkdir_p(path.dirname(full_path), 0755);
      fs.writeFileSync(full_path, self.files.client_cacheable[rel_path]);
    }

    // -- Add query params to client js and css --
    // This busts through browser caches when files change.
    var add_query_param = function (file) {
      if (file in self.files.client_cacheable)
        return file;
      else if (file in self.files.client) {
        var hash = crypto.createHash('sha1');
        hash.update(self.files.client[file]);
        var digest = hash.digest('hex');
        return file + "?" + digest;
      }
      // er? file we don't know how to serve? thats not right...
      return file;
    };
    self.js.client = _.map(self.js.client, add_query_param);
    self.css = _.map(self.css, add_query_param);

    // ---  Server code and generated files ---

    app_json.load = [];
    files.mkdir_p(path.join(build_path, 'app'), 0755);
    for (var rel_path in self.files.server) {
      var path_in_bundle = path.join('app', rel_path);
      var full_path = path.join(build_path, path_in_bundle);
      app_json.load.push(path_in_bundle);
      files.mkdir_p(path.dirname(full_path), 0755);
      fs.writeFileSync(full_path, self.files.server[rel_path]);
    }

    fs.writeFileSync(path.join(build_path, 'app.html'),
                     self._generate_app_html());
    dependencies_json.core.push(path.join('lib', 'app.html.in'));

    fs.writeFileSync(path.join(build_path, 'unsupported.html'),
                     fs.readFileSync(path.join(__dirname, "unsupported.html")));
    dependencies_json.core.push(path.join('lib', 'unsupported.html'));

    // --- Documentation, and running from the command line ---

    fs.writeFileSync(path.join(build_path, 'main.js'),
"require(require('path').join(__dirname, 'server', 'server.js'));\n");

    fs.writeFileSync(path.join(build_path, 'README'),
"This is a Meteor application bundle. It has only one dependency,\n" +
"node.js (with the 'fibers' package). To run the application:\n" +
"\n" +
"  $ npm install fibers\n" +
"  $ export MONGO_URL='mongodb://user:password@host:port/databasename'\n" +
"  $ export ROOT_URL='http://example.com'\n" +
"  $ export MAIL_URL='smtp://user:password@mailhost:port/'\n" +
"  $ node main.js\n" +
"\n" +
"Use the PORT environment variable to set the port where the\n" +
"application will listen. The default is 80, but that will require\n" +
"root on most systems.\n" +
"\n" +
"Find out more about Meteor at meteor.com.\n");

    // --- Metadata ---

    dependencies_json.extensions = self._app_extensions();
    dependencies_json.exclude = _.pluck(ignore_files, 'source');
    dependencies_json.packages = {};
    for (var id in self.packages) {
      var inst = self.packages[id];
      if (inst.pkg.name)
        dependencies_json.packages[inst.pkg.name] = _.keys(inst.dependencies);
    }

    fs.writeFileSync(path.join(build_path, 'app.json'),
                     JSON.stringify(app_json));
    fs.writeFileSync(path.join(build_path, 'dependencies.json'),
                     JSON.stringify(dependencies_json));

    // --- Move into place ---

    // XXX cleaner error handling (no exceptions)
    files.rm_recursive(output_path);
    fs.renameSync(build_path, output_path);
  }

});

///////////////////////////////////////////////////////////////////////////////
// Main
///////////////////////////////////////////////////////////////////////////////

/**
 * Take the Meteor app in project_dir, and compile it into a bundle at
 * output_path. output_path will be created if it doesn't exist (it
 * will be a directory), and removed if it does exist.
 *
 * Returns undefined on success. On failure, returns an array of
 * strings, the error messages. On failure, a bundle will still be
 * written to output_path. It is probably broken, but it is supposed
 * to contain correct dependency information, so you can tell when to
 * try bundling again.
 *
 * It's unlikely to be useful to run a package (as opposed to an app)
 * without including its tests, but it's well-defined.
 *
 * options include:
 * - noMinify : don't minify the assets
 *
 * - nodeModulesMode : decide on how to create the bundle's
 *   node_modules directory. one of:
 *     'skip' : don't create node_modules. used by `meteor deploy`, since
 *              our production servers already have all of the node modules
 *     'copy' : copy from a prebuilt local installation. used by
 *              `meteor bundle`
 *     'symlink' : symlink from a prebuild local installation. used
 *                 by `meteor run`
 *
 * - testPackages : array of package names whose tests should be included
 *   in this bundle
 *
 * - versionOverride : (for tests) a meteor release version to use
 *   instead of reading from .meteor/version
 */
exports.bundle = function (app_dir, output_path, options) {
  if (!options || !options.nodeModulesMode) {
    throw new Error("Must pass options.nodeModulesMode");
  }

  try {
    // Create a bundle, add the project
    packages.flush();

    var bundle = new Bundle;
    var manifest;
    if (options.versionOverride)
      manifest = packages.manifestForReleaseVersion(options.versionOverride);
    else
      manifest = packages.manifestForProject(app_dir);

    if (!manifest) {
      // XXX We should instead use the latest version installed, and
      // notify the user.
      // https://app.asana.com/0/2604247562419/2765125200674
      console.log("Couldn't find .meteor/version -- only searching local packages.");
    }
    bundle.manifest = manifest;

    // our manifest is set, let's now load the app
    var app = packages.get_for_app(app_dir, ignore_files);
    bundle.use(app);

    // Include tests if requested
    if (options.testPackages) {
      _.each(options.testPackages, function(packageName) {
        bundle.includeTests(packageName);
      });
    }

    // Minify, if requested
    if (!options.noMinify)
      bundle.minify();

    // Write to disk
    bundle.write_to_directory(output_path, app_dir, options.nodeModulesMode);

    if (bundle.errors.length)
      return bundle.errors;
  } catch (err) {
    return ["Exception while bundling application:\n" + (err.stack || err)];
  }
};