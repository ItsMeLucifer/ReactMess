const WebSocket = require('ws');
var models = require('./server.js').models;

const ws = new WebSocket.Server({ port: 8080 });
var _ = require('lodash');
const clients = [];
ws.on('connection', (ws) => {
    function getInitialThreads(userId) {
        models.Thread.find({ where: {}, include: 'Messages' }, (err, threads) => {
            if (!err && threads) {
                threads.forEach((thread, i) => {
                    let profiles = [];
                    if (thread.users.filter(u => u.userId === userId.toString()).length > 0) {
                        thread.users.forEach((user, ui) => {
                            models.Profile.findOne({ where: { userId: user.userId } }, (err3, profile) => {
                                if (!err3 && profile) {
                                    const newProfile = {
                                        name: profile.name,
                                        email: profile.email,
                                        userId: profile.userId,
                                        avatar: profile.avatar,
                                        id: profile.id
                                    };
                                    profiles.push(newProfile);
                                    if (ui === thread.users.length - 1) {
                                        thread.updateAttributes({ profiles: profiles }, { validate: false }, (err4, updated) => {
                                            if (!err4 && updated) {
                                                if (i === threads.length - 1) {
                                                    ws.send(JSON.stringify({
                                                        type: 'INITIAL_THREADS',
                                                        data: threads
                                                    }))
                                                }
                                            }
                                        })

                                    }
                                }
                            });

                        })
                    }



                })
            }
        })
    }
    function login(email, pass) {
        models.User.login({ email: email, password: pass }, (err, result) => {
            if (err) {
                ws.send(JSON.stringify({
                    type: 'ERROR',
                    error: err
                }));
            } else {
                models.User.findOne({ where: { id: result.userId }, include: 'Profile' }, (err2, user) => {
                    if (err2) {
                        ws.send(JSON.stringify({
                            type: 'ERROR',
                            error: err2
                        }));
                    } else {
                        ws.uid = user.id + new Date().getTime().toString();
                        const userObject = {
                            id: user.id,
                            email: user.email,
                            ws: ws
                        };

                        clients.push(userObject);
                        getInitialThreads(user.id);
                        ws.send(JSON.stringify({
                            type: 'LOGGEDIN',
                            data: {
                                session: result,
                                user: user
                            }
                        }))
                    }

                })
            }
        })
    }
    ws.on('close', (req) => {
        console.log('Request close', req);
        let clientIndex = -1;
        clients.map((c, i) => {
            if (c.ws._closeCode === req) {
                clientIndex = i;
            }
        });
        if (clientIndex > -1) {
            clients.splice(clientIndex, 1);
        }
    })
    ws.on('message', (message) => {

        let parsed = JSON.parse(message);
        console.log('Got message', parsed.type);
        if (parsed) {
            switch (parsed.type) {
                case 'SIGNUP':
                    models.User.create(parsed.data, (err, user) => {
                        if (err) {
                            ws.send(JSON.stringify({
                                type: 'ERROR',
                                error: err
                            }));
                        } else {
                            models.Profile.create({
                                userId: user.id,
                                name: parsed.data.name,
                                email: parsed.data.email
                            }, (profileErr, profile) => {

                            })
                        }
                    })
                    break;
                case 'CONNECT_WITH_TOKEN':
                    models.User.findById(parsed.data.userId, (err2, user) => {
                        if (!err2 && user) {
                            ws.uid = user.id + new Date().getTime().toString();
                            const userObject = {
                                id: user.id,
                                email: user.email,
                                ws: ws
                            };
                            clients.push(userObject);
                            getInitialThreads(user.id);
                            // ws.send(JSON.stringify({
                            //     type: 'LOGGEDIN',
                            //     data: {
                            //         session: result,
                            //         user: user
                            //     }
                            // }))
                        }
                    })
                    break;
                case 'LOGIN':

                    login(parsed.data.email, parsed.data.password);
                    break;
                case 'SEARCH':

                    models.User.find({ where: { email: { like: parsed.data } } }, (err2, users) => {
                        if (!err2 && users) {
                            ws.send(JSON.stringify({
                                type: 'GOT_USERS',
                                data: {
                                    users: users
                                }
                            }))
                        }
                    })
                    break;
                case 'FIND_THREAD':
                    models.Thread.findOne({
                        where: {
                            and: [
                                { users: { like: parsed.data[0].id } },
                                { users: { like: parsed.data[1].id } },
                            ]
                        }
                    }, (err, thread) => {
                        if (!err && thread) {
                            console.log('Found a Thread');
                            ws.send(JSON.stringify({
                                type: 'ADD_THREAD',
                                data: thread
                            }))
                        } else {
                            console.log('New Thread created');
                            const usersArray = parsed.data.map(user => ({
                                userId: user.id,
                                username: user.name
                            }))
                            models.Thread.create({
                                lastUpdated: new Date(),
                                users: usersArray,
                                name: '',
                                image: ''
                            }, (err2, thread2) => {
                                if (!err2 && thread2) {
                                    clients.filter(u => thread2.users.indexOf(u.id.toString()) > -1).map(client => {

                                        client.ws.send(JSON.stringify({
                                            type: 'ADD_THREAD',
                                            data: thread2
                                        }))
                                    })

                                }
                            })
                        }
                    });
                    break;
                case 'THREAD_LOAD':
                    models.Message.find({
                        where: {
                            threadId: parsed.data.threadId
                        }, order: 'date DESC',
                        skip: parsed.data.skip,
                        limit: 10,
                    }, (err2, messages) => {
                        if (!err2 && messages) {
                            ws.send(JSON.stringify({
                                type: 'GOT_MESSAGES',
                                threadId: parsed.data.threadId,
                                messages: messages,
                            }));
                        }
                    });
                    break;
                case 'ADD_MESSAGE':
                    models.Thread.findById(parsed.threadId, (err2, thread) => {
                        if (!err2 && thread) {
                            models.Message.upsert(parsed.message, (err3, message) => {

                                if (!err3 && message) {
                                    clients.filter(client => (thread.users.filter(user => user.userId === client.id.toString())).length > 0).forEach(client => {
                                        client.ws.send(JSON.stringify({
                                            type: 'ADD_MESSAGE_TO_THREAD',
                                            threadId: parsed.threadId,
                                            message: message
                                        }));
                                    });
                                }
                            });
                        }
                    });
                    break;
                case 'THREAD_NICK_CHANGED':
                    models.Thread.findById(parsed.threadId, (error, thread) => {
                        if (!error && thread) {
                            let updatedUsers = thread.users.map(user => ({
                                userId: user.userId,
                                username: user.userId === parsed.userId ? parsed.newNick : user.username
                            }))
                            updatedUsers = { users: updatedUsers };
                            thread.updateAttributes(updatedUsers, { validate: false }, function (err2, updated) {
                                if (!err2 && updated) {
                                    clients.filter(client => (thread.users.filter(user => user.userId === client.id.toString())).length > 0).forEach(client => {
                                        client.ws.send(JSON.stringify({
                                            type: 'THREAD_USERS_DATA_CHANGED',
                                            threadId: parsed.threadId,
                                            users: thread.users
                                        }))
                                    })
                                }
                            })
                        }
                    });
                    break;
                case 'THREAD_NAME_CHANGED':
                    models.Thread.findById(parsed.threadId, (error, thread) => {
                        if (!error && thread) {
                            const newName = ({ name: parsed.newThreadName });
                            thread.updateAttributes(newName, { validate: false }, (err2, updated) => {
                                if (!err2 && updated) {
                                    clients.filter(client => (thread.users.filter(user => user.userId === client.id.toString())).length > 0).forEach(client => {
                                        client.ws.send(JSON.stringify({
                                            type: 'THREAD_NAME_KEY_CHANGED',
                                            threadId: parsed.threadId,
                                            threadName: parsed.newThreadName
                                        }))
                                    })
                                }
                            })
                        }
                    })
                    break;
                case 'THREAD_AVATAR_CHANGED':
                    models.Thread.findById(parsed.threadId, (err, thread) => {
                        if (!err && thread) {
                            thread.updateAttributes({ image: parsed.avatar }, { validate: false }, (err2, updated) => {
                                if (!err2 && updated) {
                                    clients.filter(client => (thread.users.filter(user => user.userId === client.id.toString())).length > 0).forEach(client => {
                                        client.ws.send(JSON.stringify({
                                            type: 'THREAD_IMAGE_CHANGED',
                                            threadId: parsed.threadId,
                                            avatar: parsed.avatar
                                        }))
                                    })
                                }
                            })
                        }
                    })
                    break;
                case 'PROFILE_DATA_UPDATED':
                    models.Profile.findById(parsed.profileId, (err, profile) => {
                        if (!err && profile) {
                            const updatedProfile = {
                                name: parsed.user.name,
                                email: parsed.user.email,
                                avatar: parsed.user.avatar
                            }
                            profile.updateAttributes(updatedProfile, { validate: false }, (err2, updated) => {
                                if (!err2 && updated) {
                                    clients.filter(client => client.id === parsed.user.id).forEach(client => {
                                        client.ws.send(JSON.stringify({
                                            type: 'PROFILE_UPDATED',
                                            profile: updated,
                                            userId: parsed.user.id
                                        }))
                                    })
                                }
                            })
                        }
                    })
                    break;
                case 'GET_ALL_CLIENTS':
                    const onlineUsers = [];
                    console.log(clients.length);
                    clients.filter(client => client.id.toString() !== parsed.userId).forEach((client, ci) => {
                        models.User.findOne({ where: { id: client.id }, include: 'Profile' }, (err, user) => {
                            if (!err && user) {
                                console.log('found users', user.name)
                                const newUser = user.toJSON();
                                onlineUsers.push({
                                    userId: newUser.id,
                                    name: newUser.name,
                                    avatar: newUser.Profile.avatar
                                })
                                if (ci === clients.filter(client => client.id.toString() !== parsed.userId).length - 1) {
                                    clients.filter(client => client.id.toString() === parsed.userId).forEach(client => {
                                        client.ws.send(JSON.stringify({
                                            type: 'CLIENTS_DATA',
                                            clients: onlineUsers
                                        }))
                                    })
                                }
                            }

                        })

                    })

                    break;
                case 'CREATE_A_GROUP':
                    const users = [];
                    parsed.users.forEach((userId, userIndex) => {
                        models.User.findOne({ where: { id: userId } }, (error, user) => {
                            if (!error && user) {
                                users.push({
                                    userId: userId,
                                    username: user.name
                                })
                                if (userIndex === parsed.users.length - 1) {
                                    models.Thread.create({
                                        lastUpdated: new Date(),
                                        users: users,
                                        name: 'New Group',
                                        image: ''
                                    }, (err2, thread) => {
                                        if (!err2 && thread) {
                                            clients.filter(client => thread.users.filter(user => user.userId === client.id.toString()).length > 0).forEach(client => {
                                                console.log('New group data sent')
                                                client.ws.send(JSON.stringify({
                                                    type: 'NEW_GROUP_CREATED',
                                                    thread: thread
                                                }))
                                                getInitialThreads(client.id);
                                            })
                                        }
                                    });
                                }
                            }
                        })
                    })
                    break;
                default:
                    console.log('Nothing to see here');
            }
        }
    });
})