const request = require('request');
const config = require('config');
const async = require('async');
const AWS = require('aws-sdk');
AWS.config.update({
    region: 'ap-northeast-2',
    endpoint: "http://dynamodb.ap-northeast-2.amazonaws.com"
});

//const dynamodb = new AWS.DynamoDB();
const docClient = new AWS.DynamoDB.DocumentClient();

var now;

var req = request.defaults({
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'ko,en-US;q=0.8,en;q=0.6'
    },
    jar: true,
    gzip: true,
    followAllRedirects: true,
    //encoding: null
});

var sendMessage = function (message, chat_id, callback) {
    if (message.length > 0 && chat_id > 0) {
        var telegramConfig = config.get('telegram');
        var option = {
            uri: `https://api.telegram.org/${telegramConfig.bot_id}:${telegramConfig.token}/sendMessage`,
            method: 'POST',
            json: true,
            body: {
                'chat_id': chat_id,
                'text': message
            }
        };

        req(option, function (err, response, body) {
            if (!err && (body && !body.ok)) {
                console.log(body);
                callback("Send Message Fail", { result: "nok" });
            } else {
                callback(err, { result: "ok" });
            }
        });
    } else {
        callback(null, { result: "no message" });
    }
};

var setWebhook = function (result, callback) {
    var telegramConfig = config.get('telegram');
    var option = {
        uri: `https://api.telegram.org/${telegramConfig.bot_id}:${telegramConfig.token}/setWebhook`,
        method: 'GET',
        json: true,
        qs: {
            'url': telegramConfig.service_api_url,
        }
    };

    req(option, function (err, res, body) {
        console.log(body);
        callback(err, body.result);
    });
};

var getWebhookInfo = function (result, callback) {
    var telegramConfig = config.get('telegram');
    var option = {
        uri: `https://api.telegram.org/${telegramConfig.bot_id}:${telegramConfig.token}/getWebhookInfo`,
        method: 'GET',
        json: true,
    };

    req(option, function (err, res, body) {
        console.log(body);
        callback(err, body.result);
    });
};

var deleteWebhook = function (result, callback) {
    var telegramConfig = config.get('telegram');
    var option = {
        uri: `https://api.telegram.org/${telegramConfig.bot_id}:${telegramConfig.token}/deleteWebhook`,
        method: 'GET',
        json: true,
    };

    req(option, function (err, res, body) {
        console.log(body);
        callback(err, body.result);
    });
};

var saveMessage = function (update, response, callback) {
    var telegramConfig = config.get('telegram');

    update.bot_id = telegramConfig.bot_id;
    update.timestamp = now;
    update.ttl = now + 30 * 24 * 60 * 60;

    var putParams = {
        TableName: 'telegram',
        Item: update,
    };

    console.log("Saving Update");
    docClient.put(putParams, (err, res) => {
        if (!err) {
            console.log(JSON.stringify(res));
        }
        callback(err, update, response);
    });
};

var getProductId = function (item) {
    if (item.title.indexOf("컬쳐랜드") > -1) {
        return "컬쳐랜드";
    }
    if (item.title.indexOf("해피머니") > -1) {
        return "해피머니";
    }
    if (item.title.indexOf("도서문화상품권") > -1) {
        return "도서문화상품권";
    }
    if (item.title.indexOf("롯데") > -1) {
        return "롯데";
    }
    if (item.title.indexOf("신세계") > -1) {
        return "신세계";
    }

    return "";
};

var getStatistics = function (item, callback) {
    var productId = getProductId(item);
    var lowPrices = {
        _007d_price: item.price,
        _030d_price: item.price,
        _365d_price: item.price,
    };

    if (productId.length === 0) {
        callback(lowPrices);
        return;
    }

    var getParams = {
        TableName: 'webdata',
        Key: {
            site: productId,
            timestamp: 0,
        }
    };

    console.log(`Get Statistics for ${productId}`);
    docClient.get(getParams, (err, res) => {
        var data = [];
        if (!err) {
            console.log(JSON.stringify(res));
            if (res && res.Item && res.Item.data) {
                data = res.Item.data;
            }
        }

        lowPrices = data.reduce((prev, curr) => {
            // 7일 이내 데이터이면
            if (now < curr.ts + 7 * 24 * 60 * 60) {
                if (curr.price < prev._007d_price) {
                    prev._007d_price = curr.price;
                }
            }
            // 30일 이내 데이터이면
            if (now < curr.ts + 30 * 24 * 60 * 60) {
                if (curr.price < prev._030d_price) {
                    prev._030d_price = curr.price;
                }
            }
            // 1년 이내 데이터이면
            if (now < curr.ts + 365 * 24 * 60 * 60) {
                if (curr.price < prev._365d_price) {
                    prev._365d_price = curr.price;
                }
            }
            return prev;
        }, lowPrices);
        callback(lowPrices);
    });
};

var processCommandGiftcard = function(update, callback) {
    var message = '';
    var queryParams = {
        TableName: 'webdata',
        KeyConditionExpression: "#site = :site",
        ScanIndexForward: false,
        Limit: 1,
        ExpressionAttributeNames: {
            "#site": "site"
        },
        ExpressionAttributeValues: {
            ":site": 'wemakeprice-collect'
        }
    };
    docClient.query(queryParams, (err, res) => {
        if (!err) {
            var saved = { items: [] };
            if (res.Items.length > 0 && res.Items[0].data) {
                saved = res.Items[0].data;
            }
            async.each(saved.items, (item, callback) => {
                getStatistics(item, (lowPrices) => {
                    message += `품명: ${item.title}\nURL: ${item.url}\n가격: ${item.price}\n최저가: ${item.lowestPrice}\n주최저가: ${lowPrices._007d_price}\n월최저가: ${lowPrices._030d_price}\n년최저가: ${lowPrices._365d_price}\n\n`;
                    callback(null);
                });
            }, function(err) {
                sendMessage(message, update.message.chat.id, function(err, result) {
                    callback(err, "", 0);
                });
            });
        } else {
            callback(null, "", 0);
        }
    });
};

var processMessage = function (update, response, callback) {
    if (update.message) {
        console.log(`${update.message.from.last_name} ${update.message.from.first_name}(${update.message.from.username}): ${update.message.text}`);
        if (!update.message.from.is_bot) {
            if (update.message.text.startsWith("/giftcard")) {
                processCommandGiftcard(update, callback);
                return;
            }
        }
    }

    callback(null, "", 0);
};

exports.webhook = function (event, context, callback) {
    async.waterfall([
        function (callback) {
            callback(null, {});
        },
        getWebhookInfo,
        deleteWebhook,
        setWebhook,
        getWebhookInfo,
    ], function (err) {
        if (err) {
            console.log(err);
        }
        if (callback) {
            callback(err);
        }
    });
};

exports.handler = function (event, context, callback) {
    now = Math.floor(Date.now() / 1000);

    async.waterfall([
        function (callback) {
            callback(null, JSON.parse(event.body), {});
        },
        saveMessage,
        processMessage,
        sendMessage,
    ], function (err, response) {
        if (err) {
            console.log(err);
        }

        callback(err, {
            "statusCode": 200,
            "headers": {
            },
            "body": JSON.stringify(response),
            "isBase64Encoded": false
        });
    });
};
