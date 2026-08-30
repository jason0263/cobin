<?php
if (isset($_GET['error'])) {
    file_put_contents('js_errors.txt', $_GET['error'] . "\n", FILE_APPEND);
    echo "Error logged.";
} else {
    echo "No error provided.";
}
?>
