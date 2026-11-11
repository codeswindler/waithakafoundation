-- A separate database for the automated tests (npm test wipes its tables each run).
CREATE DATABASE IF NOT EXISTS waithaka_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON waithaka_test.* TO 'waithaka'@'%';
FLUSH PRIVILEGES;
