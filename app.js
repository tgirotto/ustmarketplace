var fs = require('fs');
var express = require('express');
var logger = require('morgan');
var bodyParser = require('body-parser');
var cookieParser = require('cookie-parser');
var request = require('request');
var busboy = require('connect-busboy');
var elastic = require('elasticsearch');
var nodemailer = require('nodemailer');

var SERVER_PORT = 3000;
var ES_PORT = ':9200';
var HOST = 'localhost';
var IP = 'ustmarketplace.ddns.net';
var INDEX = 'ustmarketplace';
var TYPE = 'item';
var EMAIL_EXT = '@ust.hk';

var app = express();
var client = new elastic.Client({host: HOST + ES_PORT});
var transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'ustmarketplace@gmail.com',
        pass: '********'
    }
});

app.use(logger('dev'));
app.set('views', __dirname + '/views/pages');
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);
app.use(bodyParser.urlencoded({ extended: false}));
app.use( require('cookie-parser')() );
app.use(bodyParser.json());
app.use(cookieParser());
app.use(busboy());
app.set('port', (process.env.PORT || SERVER_PORT));
app.use(express.static(__dirname + '/public'));

/*******************************************************************************/

app.get('/', function(req, res) {
	getAllItems(function(array) {
		if(array == null)
			res.render('error.ejs');
		else {
			res.render('index.ejs', {
				items : array
			});	
		}	
	});
});

app.get('/error', function(req, res) {
	res.render('error.ejs');
});

app.get('/unauthorised', function(req, res) {
	res.render('unauthorised.ejs');
});

app.get('/about', function(req, res) {
	res.render('about.ejs');
});

app.get('/contact', function(req, res) {
	res.render('contact.ejs');
});

app.post('/message', function(req, res) {
	if(authorise(req.body.author_itsc)) {
		getItemById(req.body.item_id, function(item) {
			sendMessageEmail(req.body, item, function() {
				res.json({data : 'ok'});
			});
		});
	} else
		res.json({data : 'unauthorised'});
});

app.post('/upload', function(req, res) {
	var item_name,
		item_description,
		item_price,
		item_image;

	req.pipe(req.busboy);
	req.busboy.on('field', function(fieldname, val, fieldnameTruncated, valTruncated) {
	    if(fieldname == 'item_name')
	     	item_name = val;
	  	if(fieldname == 'item_price')
	      	item_price = val;
	    if(fieldname == 'item_description')
	      	item_description = val;
	  	if(fieldname == 'item_image')
	    	item_image = val;
	    if(fieldname == 'item_owner') {
	    	item_owner = val;

	    	if(authorise(item_owner)) {
				req.busboy.on('file', function (fieldname, file, filename) {
					createItem({
			    		name: item_name,
			    		price: item_price,
			    		description: item_description,
			    		date: Math.floor(new Date().getTime() / 1000),
			    		owner: item_owner,
			    		active: 'true'
			    	}, function(err, obj) {
			    		if(err == null) {
			    			fstream = fs.createWriteStream(__dirname + '/public/img/' + obj._id + '.jpg');
						    file.pipe(fstream);
						    fstream.on('close', function() {
						    	getItemById(obj._id, function(obj) {
						    		sendUploadEmail(obj, function() {
							    		res.redirect('/');
							    	});
						    	});
						    });
			    		} else
			    			res.redirect('/error');
			    	}); 
				});
			} else
				res.redirect('/unauthorised');
	    }
	});
});

app.get('/withdraw', function(req, res) {
	client.update({
	  index: INDEX,
	  type: TYPE,
	  id: req.query._id,
	  body: {
	    doc: {
	      active: 'false'
	    }
	  }
	}, function (error, response) {
		if(error != null)
			res.render('error.ejs');
		else
			res.render('withdraw.ejs');
	})
});

/*******************************************************************************/
function createItem(obj, callback) {
	client.create({
		index: INDEX,
	    type: TYPE,
	  	body: obj
	}, function (err, res) {
		callback(err, res);
	});
};


function sendUploadEmail(item, callback) {
	var mailOptions = {
	    from: 'UST marketplace <ustmarketplace@gmail.com>',
	    to: item._source.owner,
	    subject: '✔ You successfully posted an item!',
	    html: '<p>Hey, just letting you know that you successfully posted the following item:</p>' +
	    	  '<p>Item name: ' + item._source.name + '</p>' +
	    	  '<p>Item description:' + item._source.description + '</p>' +
	    	  '<p>Item price: ' + item._source.price + '</p>' +
	    	  '<br>' +
	    	  '<p><a href="http://' + IP + '/withdraw?_id=' + item._id + '">Withdraw item from marketplace</a></p>' +
	    	  '<br>'
	};

	transporter.sendMail(mailOptions, function(error, info) {
	    if(error)
	    	console.log('An error occurred');
	    else
	    	callback();
	});
};

function sendMessageEmail(post, item, callback) {
	var mailOptions = {
	    from: 'ustmarketplace <tommaso.girotto91@gmail.com>', // sender address
	    to: item._source.owner, // list of receivers
	    subject: '✔ Someone\'s interested in your post!', // Subject line
	    html: '<p>Hey, someone would like to know more about:</p>' +
	    	  '<p>Item name: ' + item._source.name + '</p>' +
	    	  '<p>Item description:' + item._source.description + '</p>' +
	    	  '<p>Item price: ' + item._source.price + '</p>' +
	    	  '<br>' +
	    	  '<p>' + post.author_itsc + ' writes:</p>' +
	    	  '<p>' + post.content + '</p>' +
	    	  '<br>' +
	    	  '<p>To reply, send an email to: <a href="mailto:' + post.author_itsc + '">' + post.author_itsc + '</a></p>' +
	    	  '<br>' +
	    	  '<p><a href="http://' + IP + '/withdraw?_id=' + item._id + '">Withdraw item from marketplace</a></p>' +
	    	  '<br>'
	};

	transporter.sendMail(mailOptions, function(error, info) {
	    if(error)
	    	console.log('An error occurred');
	    else
	    	callback();
	});
};

function getAllItems(callback) {
	var array = [];
	var end = Math.floor(new Date().getTime() / 1000);
	var start = end - 2592000;

	var obj = {
		index: INDEX,
		body: {
			from : 0, 
			size : 5000,
	    	query: {
		        filtered: {
		            query: {
		                match_all: {}
		            },
		            filter: {
		                and: [
		                    {
		                        range : {
		                            date : { 
		                                from : start, 
		                                to : end
		                            }
		                        },
		                    },
		                    {
		                        term: {
		                            active: 'true'
		                        }
		                    }
		                ]
		            }
		        }
		    }
	  	}
	};

	client.search(obj, function (err, res) {
		if(err == null) {
			for(var i = 0; i < res.hits.total; i++)
				array.push(res.hits.hits[i]);
		}

		callback(array);
	});
};

function getItemById(id, callback) {
	request.get('http://localhost:9200/' + INDEX + '/' + TYPE + '/' + id, function(err, res, body) {
		if(err != null)
			console.log('an error occurred');
		else
			callback(JSON.parse(body));
	});
};

function authorise(email) {
	var s = 'ust.hk';

 	if(email.indexOf(s) > -1)
 		return true;
 	else
 		return false;
};

/*******************************************************************************/
app.use(function(req, res, next) {
    var err = new Error('Not Found');
    err.status = 404;
    next(err);
});

app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    console.log(err.message);
});

var server = app.listen(SERVER_PORT, function() {
	console.log('listening on port ', SERVER_PORT);
});
