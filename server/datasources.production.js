
module.exports = {
    db: {
        connector: 'mongodb',
        url: `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@blogdatabase.${process.env.DB_SERVER}.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`,
        hostname: process.env.DB_HOST,
        port: process.env.DB_PORT || 27017,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: 'chatServer',
    }
}