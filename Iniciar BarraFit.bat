@echo off
title Servidor Barra Fit 360
color 0A

echo ================================================================
echo           INICIANDO SISTEMA BARRA FIT 360
echo ================================================================
echo.
echo 1. Encendiendo base de datos...
echo 2. Conectando con el celular...
echo 3. Abriendo aplicacion en pantalla...
echo.
echo IMPORTANTE: No cierres esta ventana negra mientras estes 
echo usando el sistema. Para apagar el sistema, simplemente 
echo cierra esta ventana.
echo ================================================================
echo.

:: Lanzar Chrome en modo App despues de 4 segundos (tiempo para que encienda Node)
start /B cmd /c "timeout /t 4 /nobreak > nul && start chrome --app=http://localhost:3000"

:: Ejecutar el servidor y el tunel en esta misma ventana
npm run dev:tunnel
