@echo off
rem Drag a G-code file posted from SOLIDWORKS CAM onto this file.
rem It makes a GRBL-ready copy next to it, named <file>_grbl.nc.
if "%~1"=="" (
    echo Drag a posted SOLIDWORKS CAM file onto this .bat to convert it.
    pause
    exit /b
)
for %%F in (%*) do python "%~dp0solidworks_to_grbl.py" "%%~F"
pause
