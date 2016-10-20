var Url = require('url');

function createHttpExecutorService(execlib, ParentService) {
  'use strict';
  var lib = execlib.lib,
    q = lib.q,
    qlib = lib.qlib;

  function factoryCreator(parentFactory) {
    return {
      'service': require('./users/serviceusercreator')(execlib, parentFactory.get('service')),
      'user': require('./users/usercreator')(execlib, parentFactory.get('user')) 
    };
  }

  function HttpExecutorService(prophash) {
    ParentService.call(this, prophash);
    this.strategynames = Object.keys(prophash.strategies);
    console.log(process.pid, 'strategynames!', this.strategynames);
    this.guardedMethods = prophash.guardedMethods;
  }
  
  ParentService.inherit(HttpExecutorService, factoryCreator);
  
  HttpExecutorService.prototype.__cleanUp = function() {
    this.guardedMethods = null;
    this.strategynames = null;
    ParentService.prototype.__cleanUp.call(this);
  };
  
  HttpExecutorService.prototype.extractRequestParams = function(url, req){
    if (url.alreadyprocessed) {
      console.log('already processed', url.alreadyprocessed);
      return q(url.alreadyprocessed);
    }
    if (req.method==='GET') {
      return q(url.query);
    }
    if (req.method==='PUT') {
      return this.readRequestBody(req);
    }
    return q.reject(new lib.Error('UNSUPPORTED_REQUEST_METHOD', 'Request method `'+req.method+'` is not supported'));
  };

  HttpExecutorService.prototype.authenticate = function(credentials){
    if(!this.strategynames){
      return q(null);
    }
    if(!this.authenticator){
      console.trace();
      console.error('How come EntryPointService has no authenticator?!');
      return q(null);
    }
    var resolveobj = {};
    this.strategynames.forEach(function(stratname){
      resolveobj[stratname] = credentials;
    });
    credentials = null;
    return this.authenticator.call('resolve',resolveobj);
  };

  HttpExecutorService.prototype.authenticateGuarded = function (methodname, req, res, reqparams) {
    var t = this, 
      authobj = {},
      invokeobj = {},
      processedurl = {alreadyprocessed: invokeobj},
      cleaner = function () {
        t = null;
        authobj = null;
        invokeobj = null;
        processedurl = null;
        methodname = null;
        req = null;
        res = null;
        reqparams = null;
        cleaner = null;
      },
      strategyname = this.guardedMethods[methodname],
      i,
      authprefix = '__'+strategyname+'__',
      mymethod = this[methodname];
    for (i in reqparams) {
      if (!(i in reqparams)) {
        continue;
      }
      if (i.indexOf(authprefix) === 0) {
        authobj[i.substr(authprefix.length)] = reqparams[i];
      } else {
        invokeobj[i] = reqparams[i];
      }
    }
    console.log('request object', reqparams);
    console.log('auth obj', authobj);
    console.log('invoke obj', invokeobj);
    return this.authenticate(authobj).then(
      function (result) {
        console.log('guarded auth succeeded', result);
        console.log('will call', methodname, 'with', processedurl);
        mymethod.call(t, processedurl, req, res);
        cleaner();
      },
      function (err) {
        console.error(err);
        req.end('{}');
        cleaner();
      }
    );
  };

  HttpExecutorService.prototype._onRequest = function(req,res){
    try {
    var url = Url.parse(req.url,true),
      query = url.query,
      mymethodname = url.pathname.substring(1),
      mymethod = this[mymethodname],
      isanonymous = this.anonymousMethods.indexOf(mymethodname)>=0,
      targetmethodlength = isanonymous ? 3 : 3;
    //any mymethod has to accept (url,req,res),
    if(!lib.isFunction(mymethod)){
      res.end('{}');
      return;
    }
    if(mymethod.length!==targetmethodlength){
      res.end(mymethodname+' length '+mymethod.length+' is not '+targetmethodlength);
      return;
    }
    if (this.guardedMethods[mymethodname]) {
      console.log('guarded method!', mymethodname);
      this.extractRequestParams(url, req).then(
        this.authenticateGuarded.bind(this, mymethodname, req, res)
      );
      return;
    }
    if (isanonymous) {
      if (this.allowAnonymous) {
        mymethod.call(this, url, req, res);
      } else {
        res.end('');
      }
    } else {
      mymethod.call(this, url, req, res);
    }
    } catch(e) {
      console.error(e.stack);
      console.error(e);
      res.writeHead(500, 'Internal error');
      res.end('Internal error');
    }
  };
  HttpExecutorService.prototype.readRequestBody = function (req) {
    var defer = q.defer();
    var body = '';
    function ender () {
      detacher();
      console.log('request body', body);
      defer.resolve(body);
      body = null;
      defer = null;
    }
    function errorer (err) {
      detacher();
      defer.reject(err);
      defer = null;
      body = null;
    }
    function dataer (chunk) {
      if (!body) {
        return;
      }
      body += chunk;
    }
    function detacher () {
      req.removeListener('end', ender);
      req.removeListener('error', errorer);
      req.removeListener('data', dataer);
    }
    req.on('end', ender);
    req.on('error', errorer);
    req.on('data', dataer);
    return defer.promise;
  };

  HttpExecutorService.prototype.resEnder = function (res, string) {
    return function () {
      res.end(string);
      res = null;
      string = null;
    }
  }

  HttpExecutorService.prototype.resJSONEnder = function (res, obj) {
    return this.resEnder(res, JSON.stringify(obj));
  }

  HttpExecutorService.prototype.anonymousMethods = [];

  return HttpExecutorService;
}

module.exports = createHttpExecutorService;
